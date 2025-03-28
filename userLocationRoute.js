// User location route handler
const express = require("express");
const router = express.Router();
const geoLocationService = require("./geoLocationService");
const mysql = require("mysql2/promise");
require("dotenv").config();

const mysqlPool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME || "business_recommendation_app",
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 5, // Using fewer connections since this is just for this route
  queueLimit: 0,
});

// Middleware to verify JWT token (reference from main app.js)
const authenticateToken = (req, res, next) => {
  // This would be imported from your authentication module
  // Included here for reference - will use the one from app.js in production
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Authentication required" });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid or expired token" });
    req.user = user;
    next();
  });
};
// Update user's current location - with PostgreSQL/PostGIS integration
router.post("/location", async (req, res) => {
  // Create a connection for MySQL transaction
  const mysqlConnection = await mysqlPool.getConnection();

  try {
    const { latitude, longitude, city, state, country, postal_code, user_id } =
      req.body;

    // For testing, get userId from request body
    // In production, get it from the JWT token using: const userId = req.user.id;
    const userId = user_id;

    if (!userId) {
      mysqlConnection.release();
      return res.status(400).json({ error: "User ID is required for testing" });
    }

    // Basic validation
    if (!latitude || !longitude) {
      mysqlConnection.release();
      return res
        .status(400)
        .json({ error: "Latitude and longitude are required" });
    }

    // Start MySQL transaction
    await mysqlConnection.beginTransaction();

    // --- MYSQL OPERATIONS (same as original) ---
    // 1. First, insert the new location record in MySQL
    const [locationResult] = await mysqlConnection.query(
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
    await mysqlConnection.query(
      "UPDATE user_locations SET is_current = FALSE WHERE user_id = ?",
      [userId]
    );

    // 3. Insert the new current location
    const [userLocationResult] = await mysqlConnection.query(
      "INSERT INTO user_locations (user_id, location_id, is_current) VALUES (?, ?, TRUE)",
      [userId, locationId]
    );

    // --- POSTGRESQL/POSTGIS OPERATIONS (new) ---
    // 4. Update location in PostgreSQL database using our service
    let pgResult = null;
    try {
      pgResult = await geoLocationService.upsertUserLocation(
        userId,
        latitude,
        longitude
      );
      console.log("PostgreSQL location update successful");
    } catch (pgError) {
      console.error("PostgreSQL update error:", pgError.message);
      // Continue with the transaction - don't let PostgreSQL failure break MySQL operation
    }

    // Commit the MySQL transaction if everything succeeded
    await mysqlConnection.commit();

    // Return success with combined results
    res.status(201).json({
      message: "User location updated successfully",
      mysql: {
        locationId: locationId,
        userLocationId: userLocationResult.insertId,
      },
      postgres: pgResult || { status: "failed" },
    });
  } catch (error) {
    // Rollback MySQL transaction on error
    await mysqlConnection.rollback();

    console.error("Error updating user location:", error.message);
    res.status(500).json({
      error: "Failed to update location",
      details: error.message,
    });
  } finally {
    // Always release the MySQL connection
    mysqlConnection.release();
  }
});

module.exports = router;
