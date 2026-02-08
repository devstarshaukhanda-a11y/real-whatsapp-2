const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Message = require("../models/Message");
const Group = require("../models/Group");

// 🔥 Force all numbers to same 10-digit format
function cleanPhone(p) {
  return String(p || "").replace(/\D/g, "").slice(-10);
}

// ================= REGISTER =================
router.post("/register", async (req, res) => {
  try {
    let { phone, name } = req.body;
    phone = cleanPhone(phone);

    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone is required" });
    }

    let user = await User.findOne({ phone });
    if (user) {
      return res.status(400).json({ success: false, message: "User already exists" });
    }

    user = new User({ phone, name });
    await user.save();

    res.json({ success: true, message: "User registered", user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= LOGIN =================
router.post("/login", async (req, res) => {
  try {
    let { phone } = req.body;
    phone = cleanPhone(phone);

    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone is required" });
    }

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, message: "Login success", user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= CHANGE NUMBER (🔥 FIXED) =================
router.post("/change-number", async (req, res) => {
  try {
    let { oldPhone, newPhone } = req.body;

    oldPhone = cleanPhone(oldPhone);
    newPhone = cleanPhone(newPhone);

    if (!oldPhone || !newPhone) {
      return res.status(400).json({ error: "Both numbers required" });
    }

    if (oldPhone === newPhone) {
      return res.status(400).json({ error: "Same number not allowed" });
    }

    // 🔎 check new number already exists
    const exists = await User.findOne({ phone: newPhone });
    if (exists) {
      return res.status(400).json({ error: "New number already exists" });
    }

    // 👤 update user
    const user = await User.findOneAndUpdate(
      { phone: oldPhone },
      { phone: newPhone },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // 💬 update personal messages
    await Message.updateMany(
      { from: oldPhone },
      { $set: { from: newPhone } }
    );

    await Message.updateMany(
      { to: oldPhone },
      { $set: { to: newPhone } }
    );

    // 👥 update group members (SAFE WAY)
    await Group.updateMany(
      { members: oldPhone },
      {
        $pull: { members: oldPhone }
      }
    );

    await Group.updateMany(
      { members: { $ne: newPhone } },
      {
        $push: { members: newPhone }
      }
    );

    // 👑 update group creator
    await Group.updateMany(
      { createdBy: oldPhone },
      { $set: { createdBy: newPhone } }
    );

    res.json({ success: true, newPhone });
  } catch (err) {
    console.error("❌ Change number error:", err.message);
    res.status(500).json({ error: "Change number failed" });
  }
});

// ================= DELETE ACCOUNT =================
router.post("/delete-account", async (req, res) => {
  try {
    let { phone } = req.body;
    phone = cleanPhone(phone);

    if (!phone) {
      return res.status(400).json({ error: "Phone required" });
    }

    // ❌ delete user
    const user = await User.findOneAndDelete({ phone });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // ❌ delete personal messages
    await Message.deleteMany({
      $or: [{ from: phone }, { to: phone }]
    });

    // ❌ delete group messages
    await Message.deleteMany({ from: phone, groupId: { $exists: true } });

    // ❌ remove user from groups
    await Group.updateMany(
      { members: phone },
      { $pull: { members: phone } }
    );

    // ❌ remove creator
    await Group.updateMany(
      { createdBy: phone },
      { $set: { createdBy: null } }
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ delete account error:", err.message);
    res.status(500).json({ error: "Delete account failed" });
  }
});

module.exports = router;
