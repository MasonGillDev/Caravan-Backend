// Description: This file contains the code for the Business Recommendation API server.
console.log("Starting server...");
const express = require("express");
const mysql = require("mysql2/promise"); // Using promise version for async/await
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const app = express();
const cors = require("cors");
const PORT = process.env.PORT || 3000;
require("dotenv").config();
console.log("Environment variables loaded:", {
  DB_HOST: process.env.DB_HOST,
  DB_USER: process.env.DB_USER,
  DB_NAME: process.env.DB_NAME,
  PORT: process.env.PORT,
});

app.use(express.json());
app.use(cors());

// Test endpoint to verify the app is running
app.get("/", (req, res) => {
  res.send("Hello, Business Recommendation App! Your app is running.");
});
console.log("Creating database pool...");
// Create a connection pool to the MySQL database
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME || "business_recommendation_app",
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
console.log("Database pool created");
console.log("Database connecting to:", process.env.DB_HOST);

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Authentication required" });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid or expired token" });
    req.user = user;
    next();
  });
};

// AUTHENTICATION ENDPOINTS

// Register a new user
app.post("/api/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Basic input validation
    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ error: "Username, email, and password are required." });
    }

    // Check if a user already exists
    const [existingUsers] = await pool.query(
      "SELECT user_id FROM users WHERE username = ? OR email = ?",
      [username, email]
    );

    if (existingUsers.length > 0) {
      return res
        .status(409)
        .json({ error: "Username or email already in use." });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert the new user
    const [result] = await pool.query(
      "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
      [username, email, hashedPassword]
    );

    return res.status(201).json({
      message: "User registered successfully",
      userId: result.insertId,
    });
    console.log("User Registered");
  } catch (error) {
    console.error("Registration error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required." });
    }

    // Query the user
    const [users] = await pool.query(
      "SELECT user_id, username, email, password_hash FROM users WHERE username = ?",
      [username]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const user = users[0];

    // Compare password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid credentials." });
    }
    console.log("User Logged In");
    // Generate JWT token
    const token = jwt.sign(
      { id: user.user_id, username: user.username },
      process.env.JWT_SECRET
    );

    res.status(200).json({
      token,
      user: {
        id: user.user_id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// USER LOCATION ENDPOINTS

// Update user's current location
app.post("/api/user/location", authenticateToken, async (req, res) => {
  // Create a connection for transaction
  const connection = await pool.getConnection();

  try {
    const { latitude, longitude, city, state, country, postal_code } = req.body;
    const userId = req.user.id;

    // Basic validation
    if (!latitude || !longitude) {
      connection.release();
      return res
        .status(400)
        .json({ error: "Latitude and longitude are required" });
    }

    // Start transaction
    await connection.beginTransaction();

    // 1. First, insert the new location record
    const [locationResult] = await connection.query(
      "INSERT INTO locations (latitude, longitude, city, state, country, postal_code) VALUES (?, ?, ?, ?, ?, ?)",
      [
        latitude,
        longitude,
        city || null,
        state || null,
        country || null,
        postal_code || null,
      ]
    );
    const locationId = locationResult.insertId;

    // 2. Set all existing locations for this user to is_current = FALSE
    await connection.query(
      "UPDATE user_locations SET is_current = FALSE WHERE user_id = ?",
      [userId]
    );

    // 3. Insert the new current location
    const [userLocationResult] = await connection.query(
      "INSERT INTO user_locations (user_id, location_id, is_current) VALUES (?, ?, TRUE)",
      [userId, locationId]
    );

    // Commit the transaction
    await connection.commit();

    // Return success
    res.status(201).json({
      message: "User location updated successfully",
      locationId: locationId,
      userLocationId: userLocationResult.insertId,
    });
  } catch (error) {
    // Rollback on error
    await connection.rollback();
    console.error("Error updating user location:", error.message);
    res.status(500).json({ error: "Failed to update location" });
  } finally {
    // Always release the connection
    connection.release();
  }
});

// Get user's current location
app.get("/api/user/location", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [locations] = await pool.query(
      `SELECT l.location_id, l.latitude, l.longitude, l.city, l.state, l.country, l.postal_code 
       FROM user_locations ul 
       JOIN locations l ON ul.location_id = l.location_id 
       WHERE ul.user_id = ? AND ul.is_current = TRUE`,
      [userId]
    );

    if (locations.length === 0) {
      return res.status(404).json({ error: "Current location not found" });
    }

    res.json(locations[0]);
  } catch (error) {
    console.error("Error retrieving location:", error.message);
    res.status(500).json({ error: "Failed to retrieve location" });
  }
});

// BUSINESS ENDPOINTS

// Get businesses near user location
app.get("/api/businesses/nearby", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const radius = req.query.radius || 10; // Default 10 units (e.g., km)
    const limit = req.query.limit || 20; // Default 20 results

    // Get user's current location
    const [userLocations] = await pool.query(
      `SELECT l.latitude, l.longitude 
       FROM user_locations ul 
       JOIN locations l ON ul.location_id = l.location_id 
       WHERE ul.user_id = ? AND ul.is_current = TRUE`,
      [userId]
    );

    if (userLocations.length === 0) {
      return res.status(404).json({ error: "User location not found" });
    }

    const userLat = userLocations[0].latitude;
    const userLng = userLocations[0].longitude;

    // Find nearby businesses using Haversine formula
    const [businesses] = await pool.query(
      `SELECT b.business_id, b.name, b.description, b.business_type, 
              b.rating, l.latitude, l.longitude, l.city, l.state, l.country,
              (6371 * acos(cos(radians(?)) * cos(radians(l.latitude)) * 
              cos(radians(l.longitude) - radians(?)) + 
              sin(radians(?)) * sin(radians(l.latitude)))) AS distance
       FROM businesses b
       JOIN locations l ON b.location_id = l.location_id
       HAVING distance < ?
       ORDER BY distance
       LIMIT ?`,
      [userLat, userLng, userLat, radius, parseInt(limit)]
    );

    res.json(businesses);
  } catch (error) {
    console.error("Error retrieving nearby businesses:", error.message);
    res.status(500).json({ error: "Failed to retrieve nearby businesses" });
  }
});

// Get a specific business by ID
app.get("/api/business/:id", async (req, res) => {
  try {
    const businessId = req.params.id;

    const [businesses] = await pool.query(
      `SELECT b.*, l.latitude, l.longitude, l.city, l.state, l.country, l.postal_code
       FROM businesses b
       JOIN locations l ON b.location_id = l.location_id
       WHERE b.business_id = ?`,
      [businessId]
    );

    if (businesses.length === 0) {
      return res.status(404).json({ error: "Business not found" });
    }

    // Get any upcoming events for this business
    const [events] = await pool.query(
      `SELECT * FROM events
       WHERE business_id = ? AND end_time > NOW()
       ORDER BY start_time`,
      [businessId]
    );

    // Combine business data with events
    const businessData = {
      ...businesses[0],
      events: events,
    };

    res.json(businessData);
  } catch (error) {
    console.error("Error retrieving business:", error.message);
    res.status(500).json({ error: "Failed to retrieve business" });
  }
});

// BUSINESS LIKES ENDPOINTS

// Like a business
app.post("/api/business/:id/like", authenticateToken, async (req, res) => {
  try {
    const businessId = req.params.id;
    const userId = req.user.id;

    // Check if the business exists
    const [businesses] = await pool.query(
      "SELECT business_id FROM businesses WHERE business_id = ?",
      [businessId]
    );

    if (businesses.length === 0) {
      return res.status(404).json({ error: "Business not found" });
    }

    // Check if already liked
    const [existingLikes] = await pool.query(
      "SELECT like_id FROM user_business_likes WHERE user_id = ? AND business_id = ?",
      [userId, businessId]
    );

    if (existingLikes.length > 0) {
      return res.status(409).json({ error: "Business already liked" });
    }

    // Add like
    await pool.query(
      "INSERT INTO user_business_likes (user_id, business_id) VALUES (?, ?)",
      [userId, businessId]
    );

    res.status(201).json({ message: "Business liked successfully" });
  } catch (error) {
    console.error("Error liking business:", error.message);
    res.status(500).json({ error: "Failed to like business" });
  }
});

// Unlike a business
app.delete("/api/business/:id/like", authenticateToken, async (req, res) => {
  try {
    const businessId = req.params.id;
    const userId = req.user.id;

    const [result] = await pool.query(
      "DELETE FROM user_business_likes WHERE user_id = ? AND business_id = ?",
      [userId, businessId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Like not found" });
    }

    res.json({ message: "Business unliked successfully" });
  } catch (error) {
    console.error("Error unliking business:", error.message);
    res.status(500).json({ error: "Failed to unlike business" });
  }
});

// Get liked businesses for a user
app.get("/api/user/likes", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [likes] = await pool.query(
      `SELECT b.business_id, b.name, b.description, b.business_type, 
              b.rating, l.city, l.state, l.country, ubl.created_at as liked_at
       FROM user_business_likes ubl
       JOIN businesses b ON ubl.business_id = b.business_id
       JOIN locations l ON b.location_id = l.location_id
       WHERE ubl.user_id = ?
       ORDER BY ubl.created_at DESC`,
      [userId]
    );

    res.json(likes);
  } catch (error) {
    console.error("Error retrieving likes:", error.message);
    res.status(500).json({ error: "Failed to retrieve likes" });
  }
});

// FRIENDS ENDPOINTS

// Accept/reject friend request
app.put(
  "/api/friends/request/:friendshipId",
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const friendshipId = req.params.friendshipId;
      const { status } = req.body;

      if (!status || !["accepted", "rejected"].includes(status)) {
        return res
          .status(400)
          .json({ error: "Valid status (accepted or rejected) is required" });
      }

      // Verify this is a pending friendship and user is the recipient
      const [friendships] = await pool.query(
        `SELECT * FROM friendships 
       WHERE friendship_id = ? AND user_id_2 = ? AND status = 'pending'`,
        [friendshipId, userId]
      );

      if (friendships.length === 0) {
        return res
          .status(404)
          .json({ error: "Pending friend request not found" });
      }

      // Update friendship status
      await pool.query(
        "UPDATE friendships SET status = ? WHERE friendship_id = ?",
        [status, friendshipId]
      );

      res.json({ message: `Friend request ${status}` });
    } catch (error) {
      console.error("Error responding to friend request:", error.message);
      res.status(500).json({ error: "Failed to respond to friend request" });
    }
  }
);

// Get user's friends
app.get("/api/friends", authenticateToken, async (req, res) => {
  console.log("getting friends");
  try {
    const userId = req.user.id;

    const [friends] = await pool.query(
      `SELECT f.friendship_id, f.status, f.created_at,
              IF(f.user_id_1 = ?, f.user_id_2, f.user_id_1) as friend_id,
              u.username as friend_username, u.email as friend_email
       FROM friendships f
       JOIN users u ON IF(f.user_id_1 = ?, f.user_id_2, f.user_id_1) = u.user_id
       WHERE (f.user_id_1 = ? OR f.user_id_2 = ?) AND f.status = 'accepted'`,
      [userId, userId, userId, userId]
    );

    res.json(friends);
  } catch (error) {
    console.error("Error retrieving friends:", error.message);
    res.status(500).json({ error: "Failed to retrieve friends" });
  }
});

// Get pending friend requests
// Send friend request - with improved error handling
app.post("/api/friends/request", authenticateToken, async (req, res) => {
  console.log("Posting a friend request...");
  try {
    const userId = req.user.id;
    const { friendUsername } = req.body;

    console.log(
      `User ${userId} attempting to send friend request to ${friendUsername}`
    );

    // Input validation with detailed errors
    if (!friendUsername) {
      console.log("Error: Friend username is missing in request");
      return res.status(400).json({ error: "Friend username is required" });
    }

    // Find the friend's user ID
    console.log(`Looking up user with username: ${friendUsername}`);
    const [friends] = await pool.query(
      "SELECT user_id FROM users WHERE username = ?",
      [friendUsername]
    );

    if (friends.length === 0) {
      console.log(`Error: User '${friendUsername}' not found in database`);
      return res.status(404).json({ error: "User not found" });
    }

    const friendId = friends[0].user_id;
    console.log(`Found user with ID: ${friendId}`);

    if (userId === friendId) {
      console.log("Error: User trying to send friend request to themselves");
      return res
        .status(400)
        .json({ error: "Cannot send friend request to yourself" });
    }

    // Check if friendship already exists
    console.log(
      `Checking for existing friendship between ${userId} and ${friendId}`
    );
    const [existingFriendships] = await pool.query(
      `SELECT * FROM friendships 
       WHERE (user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?)`,
      [userId, friendId, friendId, userId]
    );

    if (existingFriendships.length > 0) {
      console.log(
        `Friendship already exists with status: ${existingFriendships[0].status}`
      );
      return res.status(409).json({
        error: "Friendship already exists",
        status: existingFriendships[0].status,
      });
    }

    // Create friendship request
    console.log(
      `Creating new friendship request from ${userId} to ${friendId}`
    );
    const [result] = await pool.query(
      "INSERT INTO friendships (user_id_1, user_id_2, status) VALUES (?, ?, 'pending')",
      [userId, friendId]
    );

    console.log(
      `Successfully created friendship request with ID: ${result.insertId}`
    );
    res.status(201).json({
      message: "Friend request sent",
      friendship_id: result.insertId,
    });
  } catch (error) {
    console.error(
      "Error in friend request endpoint:",
      error.message,
      error.stack
    );
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});

const restrictByIP = (allowedIPs) => {
  return (req, res, next) => {
    const clientIP =
      req.ip ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      req.connection.socket.remoteAddress;

    // Check if client IP is in the allowed list
    // The includes handles exact matches, the some with startsWith handles CIDR-like patterns
    if (
      allowedIPs.includes(clientIP) ||
      allowedIPs.some((ip) => clientIP.startsWith(ip))
    ) {
      return next(); // IP is allowed, proceed to the endpoint
    }

    // IP is not allowed
    console.log(`Access denied for IP: ${clientIP}`);
    return res.status(403).json({ error: "Access denied" });
  };
};

const ensureDirectoryExistence = (filePath) => {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
};

// Apply the middleware to specific routes
const allowedIPs = ["127.0.0.1", "::1", "192.168.1."]; // localhost IPv4, localhost IPv6, local network

// Apply to a specific route
app.get("/api/Quad-Update", restrictByIP(allowedIPs), async (req, res) => {
  try {
    const [locations] = await pool.query(
      `SELECT latitude, longitude
       FROM locations
       ORDER BY location_id`
    );

    res.json({ data: locations });
  } catch (error) {
    console.error("Error retrieving locations:", error.message);
    res.status(500).json({ error: "Failed to retrieve locations" });
  }
});

app.get("/api/friends/requests", async (req, res) => {
  console.log("getting request...");
  try {
    const userId = req.user.id;
    const { type } = req.query; // "received" or "sent"

    if (!type || !["received", "sent"].includes(type)) {
      console.log("Error must be recieved or sentr.");
      return res
        .status(400)
        .json({ error: "Type must be 'received' or 'sent'." });
    }

    if (type === "received") {
      // find friend requests where current user is user_id_2 and status = "pending"
      const [requests] = await pool.query(
        `
        SELECT f.friendship_id, f.created_at, f.user_id_1 AS user_id,
               u.username, u.email
        FROM friendships f
        JOIN users u ON f.user_id_1 = u.user_id
        WHERE f.user_id_2 = ? AND f.status = 'pending'
      `,
        [userId]
      );
      console.log(userId);
      // map them to match the FriendRequest shape
      return res.json(
        requests.map((r) => ({
          friendship_id: r.friendship_id,
          created_at: r.created_at,
          user_id: r.user_id,
          username: r.username,
        }))
      );
    } else {
      // "sent"
      // find friend requests where current user is user_id_1 and status = "pending"
      const [requests] = await pool.query(
        `
        SELECT f.friendship_id, f.created_at, f.user_id_2 AS user_id,
               u.username, u.email
        FROM friendships f
        JOIN users u ON f.user_id_2 = u.user_id
        WHERE f.user_id_1 = ? AND f.status = 'pending'
      `,
        [userId]
      );
      console.log(userId);
      return res.json(
        requests.map((r) => ({
          friendship_id: r.friendship_id,
          created_at: r.created_at,
          user_id: r.user_id,
          username: r.username,
        }))
      );
    }
  } catch (error) {
    console.error("Error retrieving friend requests:", error.message);
    res.status(500).json({ error: "Failed to retrieve friend requests" });
  }
});

// Get a friend's location
app.get("/api/friends/:id/location", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const friendId = req.params.id;

    // 1. First check if they are actually friends
    const [friendships] = await pool.query(
      `SELECT * FROM friendships 
       WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
       AND status = 'accepted'`,
      [userId, friendId, friendId, userId]
    );

    if (friendships.length === 0) {
      return res
        .status(403)
        .json({ error: "Not authorized to view this user's location" });
    }

    // 2. Get the friend's current location
    const [locations] = await pool.query(
      `SELECT l.location_id, l.latitude, l.longitude, l.city, l.state, l.country, l.postal_code, ul.timestamp 
       FROM user_locations ul 
       JOIN locations l ON ul.location_id = l.location_id 
       WHERE ul.user_id = ? AND ul.is_current = TRUE`,
      [friendId]
    );

    if (locations.length === 0) {
      return res.status(404).json({ error: "Friend's location not found" });
    }

    res.json(locations[0]);
  } catch (error) {
    console.error("Error retrieving friend's location:", error.message);
    res.status(500).json({ error: "Failed to retrieve friend's location" });
  }
});

// PERSONALIZED RECOMMENDATIONS

// Get recommended businesses for user
app.get("/api/recommendations", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = req.query.limit || 10;

    // Get user's cluster ID
    const [userPreferences] = await pool.query(
      "SELECT cluster_id FROM user_preferences WHERE user_id = ?",
      [userId]
    );

    if (userPreferences.length === 0) {
      return res.status(404).json({ error: "User preferences not found" });
    }

    const clusterId = userPreferences[0].cluster_id;

    // Get user's current location
    const [userLocations] = await pool.query(
      `SELECT l.latitude, l.longitude 
       FROM user_locations ul 
       JOIN locations l ON ul.location_id = l.location_id 
       WHERE ul.user_id = ? AND ul.is_current = TRUE`,
      [userId]
    );

    let locationFilter = "";
    let locationParams = [clusterId, userId, parseInt(limit)];

    // If user has location, prioritize nearby businesses
    if (userLocations.length > 0) {
      const userLat = userLocations[0].latitude;
      const userLng = userLocations[0].longitude;

      locationFilter = `
        , (6371 * acos(cos(radians(?)) * cos(radians(l.latitude)) * 
        cos(radians(l.longitude) - radians(?)) + 
        sin(radians(?)) * sin(radians(l.latitude)))) AS distance
      `;
      locationParams = [
        clusterId,
        userId,
        userLat,
        userLng,
        userLat,
        parseInt(limit),
      ];
    }

    // Get recommended businesses based on cluster and not already liked
    const [recommendations] = await pool.query(
      `SELECT b.business_id, b.name, b.description, b.business_type, 
              b.rating, l.latitude, l.longitude, l.city, l.state, l.country
              ${locationFilter}
       FROM businesses b
       JOIN locations l ON b.location_id = l.location_id
       WHERE b.cluster_id = ?
       AND b.business_id NOT IN (
         SELECT business_id FROM user_business_likes WHERE user_id = ?
       )
       ${
         userLocations.length > 0
           ? "ORDER BY distance"
           : "ORDER BY b.rating DESC"
       }
       LIMIT ?`,
      locationParams
    );

    res.json(recommendations);
  } catch (error) {
    console.error("Error retrieving recommendations:", error.message);
    res.status(500).json({ error: "Failed to retrieve recommendations" });
  }
});

// SURVEY ENDPOINTS

// Get survey questions
app.get("/api/survey/questions", async (req, res) => {
  try {
    const [questions] = await pool.query(
      "SELECT * FROM survey_questions ORDER BY question_id"
    );

    // Parse the JSON in possible_answers
    questions.forEach((q) => {
      if (q.possible_answers) {
        try {
          q.possible_answers = JSON.parse(q.possible_answers);
        } catch (e) {
          console.error("Error parsing possible answers:", e);
        }
      }
    });

    res.json(questions);
  } catch (error) {
    console.error("Error retrieving survey questions:", error.message);
    res.status(500).json({ error: "Failed to retrieve survey questions" });
  }
});

// Get all current user locations for heatmap
app.get("/api/user/heatmap", authenticateToken, async (req, res) => {
  try {
    // Optional query parameter for radius (default 10km)
    const radius = req.query.radius || 10;

    // Get user's current location as center point
    const userId = req.user.id;

    // First get the user's current location
    const [userLocation] = await pool.query(
      `SELECT l.latitude, l.longitude
       FROM user_locations ul
       JOIN locations l ON ul.location_id = l.location_id
       WHERE ul.user_id = ? AND ul.is_current = TRUE`,
      [userId]
    );

    // If user doesn't have a location, return empty result
    if (userLocation.length === 0) {
      return res.json({
        locations: [],
        count: 0,
        message: "No location data available",
      });
    }

    const userLat = userLocation[0].latitude;
    const userLng = userLocation[0].longitude;

    // Get all user current locations within specified radius
    const [locationResults] = await pool.query(
      `SELECT l.location_id, l.latitude, l.longitude, l.city, l.state,
              l.country, l.postal_code, ul.timestamp,
              (6371 * acos(cos(radians(?)) * cos(radians(l.latitude)) *
              cos(radians(l.longitude) - radians(?)) +
              sin(radians(?)) * sin(radians(l.latitude)))) AS distance
       FROM user_locations ul
       JOIN locations l ON ul.location_id = l.location_id
       WHERE ul.is_current = TRUE
       HAVING distance < ?
       ORDER BY distance`,
      [userLat, userLng, userLat, radius]
    );

    // Format locations to match the expected LocationModel on the client
    const locations = locationResults.map((loc) => ({
      location_id: loc.location_id,
      latitude: loc.latitude,
      longitude: loc.longitude,
      city: loc.city,
      state: loc.state,
      country: loc.country,
      postal_code: loc.postal_code,
      timestamp: loc.timestamp,
      is_current: true,
    }));

    // Return the data
    res.json({
      locations: locations,
      count: locations.length,
      center: {
        latitude: userLat,
        longitude: userLng,
      },
    });
  } catch (error) {
    console.error("Error retrieving heatmap data:", error.message);
    res.status(500).json({ error: "Failed to retrieve heatmap data" });
  }
});

// Submit survey responses
app.post("/api/survey/submit", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { responses, clusterId } = req.body;

    if (!responses || !Array.isArray(responses) || !clusterId) {
      return res
        .status(400)
        .json({ error: "Valid responses and clusterId are required" });
    }

    // Start a transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Save each response
      for (const response of responses) {
        await connection.query(
          "INSERT INTO initial_survey_responses (user_id, question_id, answer) VALUES (?, ?, ?)",
          [userId, response.questionId, response.answer]
        );
      }

      // Create or update user preferences
      const [existingPrefs] = await connection.query(
        "SELECT preference_id FROM user_preferences WHERE user_id = ?",
        [userId]
      );

      if (existingPrefs.length > 0) {
        await connection.query(
          "UPDATE user_preferences SET cluster_id = ? WHERE user_id = ?",
          [clusterId, userId]
        );
      } else {
        await connection.query(
          "INSERT INTO user_preferences (user_id, cluster_id) VALUES (?, ?)",
          [userId, clusterId]
        );
      }

      await connection.commit();
      res
        .status(201)
        .json({ message: "Survey responses submitted successfully" });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error submitting survey:", error.message);
    res.status(500).json({ error: "Failed to submit survey responses" });
  }
});

// Start the server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Access it from other devices at http://192.168.1.235:${PORT}`);
});
