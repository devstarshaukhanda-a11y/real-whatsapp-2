const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema({
  // 🔥 COMMON
  from: { type: String, required: true },

  // 🔥 PERSONAL CHAT
  to: { type: String, default: null },

  // 🔥 GROUP CHAT
  groupId: { type: String, default: null },

  text: { type: String, default: "" },

  createdAt: { type: Date, default: Date.now },
  delivered: { type: Boolean, default: true },
  seen: { type: Boolean, default: false },

  // 🔥 FILE / IMAGE / AUDIO
  fileType: { type: String, default: null },   // image | audio | document
  fileName: { type: String, default: null },
  mimeType: { type: String, default: null },
  fileData: { type: String, default: null },   // base64

  // 🔥 DELETE LOGIC
  deletedFor: {
    type: [String],
    default: []
  },
  deletedForEveryone: {
    type: Boolean,
    default: false
  }
});

module.exports = mongoose.model("Message", MessageSchema);
