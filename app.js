// Description: Main application entry point using layered architecture
require("dotenv").config();
console.log("Starting server...");

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;

console.log("Loading middleware...");
// Import middleware
const errorHandler = require("./src/middleware/errorHandler");

console.log("Loading routes...");
// Import routes
const routes = require("./src/routes");

// Middleware setup
app.use(express.json());
app.use(cors());

// API Routes
app.use("/api", routes);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start the server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Access the API at http://localhost:${PORT}/api`);

  // Log available endpoints
  console.log("\nAvailable endpoints:");
  console.log("- GET  /api                         - Health check");
  console.log("- POST /api/auth/register           - Register new user");
  console.log("- POST /api/auth/login              - Login");
  console.log(
    "- PUT  /api/user/location           - Update user location (auth required)"
  );
  console.log(
    "- GET  /api/user/location           - Get user location (auth required)"
  );
  console.log(
    "- GET  /api/user/likes              - Get liked businesses (auth required)"
  );
  console.log(
    "- GET  /api/user/heatmap            - Get heatmap data (auth required)"
  );
  console.log(
    "- GET  /api/businesses/nearby       - Get nearby businesses (auth required)"
  );
  console.log("- GET  /api/businesses/:id          - Get business details");
  console.log(
    "- POST /api/businesses/:id/like     - Like a business (auth required)"
  );
  console.log(
    "- DELETE /api/businesses/:id/like   - Unlike a business (auth required)"
  );
  console.log(
    "- GET  /api/recommendations         - Get recommendations (auth required)"
  );
  console.log(
    "- POST /api/friends/request         - Send friend request (auth required)"
  );
  console.log(
    "- PUT  /api/friends/request/:id     - Accept/reject friend request (auth required)"
  );
  console.log(
    "- GET  /api/friends                 - Get friends list (auth required)"
  );
  console.log(
    "- GET  /api/friends/requests        - Get friend requests (auth required)"
  );
  console.log(
    "- GET  /api/friends/:id/location    - Get friend location (auth required)"
  );
  console.log("- GET  /api/survey/questions        - Get survey questions");
  console.log(
    "- POST /api/survey/submit           - Submit survey (auth required)"
  );
  console.log(
    "- GET  /api/heatmap/tiles/:z/:x/:y - Get heatmap tile (auth required)"
  );
  console.log(
    "- POST /api/heatmap/cache/clear     - Clear heatmap cache (auth required)"
  );
  console.log(
    "- GET  /api/Quad-Update             - Get all locations (legacy)"
  );
});

// Graceful shutdown
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function shutdown() {
  console.log("\nShutting down gracefully...");

  // Close database connections
  const dbConnection = require("./src/config/database");
  await dbConnection.closePools();

  process.exit(0);
}
