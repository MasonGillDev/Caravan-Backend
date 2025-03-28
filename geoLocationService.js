// Geolocation service for handling PostGIS operations
const db = require("./postgresConnection");

/**
 * GeoLocation Service - Handles PostGIS operations for user location data
 */
class GeoLocationService {
  /**
   * Upsert a user's location (insert if not exists, update if exists)
   * @param {number} userId - The user's ID
   * @param {number} latitude - Latitude coordinate
   * @param {number} longitude - Longitude coordinate
   * @returns {Promise<Object>} The database operation result
   */
  async upsertUserLocation(userId, latitude, longitude) {
    try {
      // Validate input
      this.validateCoordinates(latitude, longitude);

      // Check if user exists in the database
      const existingUser = await this.getUserLocation(userId);

      if (existingUser) {
        // User exists, update their location
        return this.updateUserLocation(userId, latitude, longitude);
      } else {
        // User doesn't exist, insert new location
        return this.insertUserLocation(userId, latitude, longitude);
      }
    } catch (error) {
      console.error("Error in upsertUserLocation:", error.message);
      throw error; // Rethrow for error handling in the caller
    }
  }

  /**
   * Get a user's location
   * @param {number} userId - The user's ID
   * @returns {Promise<Object|null>} The user's location or null if not found
   */
  async getUserLocation(userId) {
    try {
      const query = `
        SELECT 
          user_id,
          ST_X(location::geometry) as longitude,
          ST_Y(location::geometry) as latitude,
          updated_at
        FROM user_locations
        WHERE user_id = $1
      `;

      const result = await db.query(query, [userId]);
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      console.error("Error in getUserLocation:", error.message);
      throw error;
    }
  }

  /**
   * Insert a new user location
   * @param {number} userId - The user's ID
   * @param {number} latitude - Latitude coordinate
   * @param {number} longitude - Longitude coordinate
   * @returns {Promise<Object>} The database operation result
   * @private
   */
  async insertUserLocation(userId, latitude, longitude) {
    try {
      const query = `
        INSERT INTO user_locations (user_id, location, updated_at)
        VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), NOW())
        RETURNING 
          user_id,
          ST_X(location::geometry) as longitude,
          ST_Y(location::geometry) as latitude,
          updated_at
      `;

      const result = await db.query(query, [userId, longitude, latitude]);
      return result.rows[0];
    } catch (error) {
      console.error("Error in insertUserLocation:", error.message);
      throw error;
    }
  }

  /**
   * Update an existing user's location
   * @param {number} userId - The user's ID
   * @param {number} latitude - Latitude coordinate
   * @param {number} longitude - Longitude coordinate
   * @returns {Promise<Object>} The database operation result
   * @private
   */
  async updateUserLocation(userId, latitude, longitude) {
    try {
      const query = `
        UPDATE user_locations
        SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326), updated_at = NOW()
        WHERE user_id = $1
        RETURNING 
          user_id,
          ST_X(location::geometry) as longitude,
          ST_Y(location::geometry) as latitude,
          updated_at
      `;

      const result = await db.query(query, [userId, longitude, latitude]);
      return result.rows[0];
    } catch (error) {
      console.error("Error in updateUserLocation:", error.message);
      throw error;
    }
  }

  /**
   * Validate coordinates to ensure they are valid
   * @param {number} latitude - Latitude coordinate (-90 to 90)
   * @param {number} longitude - Longitude coordinate (-180 to 180)
   * @throws {Error} If coordinates are invalid
   * @private
   */
  validateCoordinates(latitude, longitude) {
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      throw new Error("Latitude and longitude must be numbers");
    }

    if (latitude < -90 || latitude > 90) {
      throw new Error("Latitude must be between -90 and 90 degrees");
    }

    if (longitude < -180 || longitude > 180) {
      throw new Error("Longitude must be between -180 and 180 degrees");
    }
  }
}

// Export a singleton instance of the service
module.exports = new GeoLocationService();
