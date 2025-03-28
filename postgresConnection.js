// PostgreSQL connection manager for geolocation data
const { Pool } = require("pg");
require("dotenv").config();

// Create a connection pool to the PostgreSQL database
const pgPool = new Pool({
  host: process.env.PG_HOST || "localhost",
  user: process.env.PG_USER || "masongill",
  password: process.env.PG_PASS,
  database: process.env.PG_NAME || "realtime_locations",
  port: process.env.PG_PORT || 5433,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: 2000, // How long to wait before timing out when connecting a new client
});

// Log connection status
pgPool.on("connect", () => {
  console.log("Connected to PostgreSQL database");
});

pgPool.on("error", (err) => {
  console.error("PostgreSQL connection error:", err.message);
});

// Test database connection on startup
const testConnection = async () => {
  try {
    const client = await pgPool.connect();
    console.log("PostgreSQL database connection test: SUCCESS");
    client.release();
    return true;
  } catch (error) {
    console.error("PostgreSQL database connection test: FAILED", error.message);
    return false;
  }
};

// Initialize connection test
testConnection();

module.exports = {
  pgPool,
  query: (text, params) => pgPool.query(text, params),
};
