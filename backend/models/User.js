const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  phone: { type: String, unique: true },
  name: String,

  online: { type: Boolean, default: false },
  lastSeen: { type: Date, default: null },

  photo: { type: String, default: null },
  about: String,

  // 🔥 EXISTING
  deletedChats: [String],
  favourites: { type: [String], default: [] },
  blocked: { type: [String], default: [] },

  // 🔥 ADD THESE (STEP-1)
  pinnedChats: { type: [String], default: [] },
  mutedChats: { type: [String], default: [] },
  unreadChats: { type: [String], default: [] }

}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);