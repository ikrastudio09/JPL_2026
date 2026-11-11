/**
 * AdminSession — server-side admin sessions.
 * Only an HMAC of the session token is stored, so a database leak does not yield usable cookies.
 * Expired sessions are removed automatically by the TTL index.
 */
import mongoose from "mongoose";

const AdminSessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  csrfToken: { type: String, required: true },
  username: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});

AdminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AdminSession =
  mongoose.models.AdminSession || mongoose.model("AdminSession", AdminSessionSchema);

export default AdminSession;
