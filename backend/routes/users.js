const express = require("express");
const router = express.Router();
const User = require("../models/User");

// Get all users except me
router.get("/:myPhone", async (req, res) => {
  try {
    const { myPhone } = req.params;

    const users = await User.find({ phone: { $ne: myPhone } });

    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/status/:phone", async (req, res) => {
  const user = await User.findOne({ phone: req.params.phone });
  if (!user) return res.json({ online: false });

  res.json({
    online: user.online,
    lastSeen: user.lastSeen
  });
});

const Message = require("../models/Message");

/**
 * DELETE MULTIPLE CHATS (FOR ME)
 */
router.post("/delete-chats", async (req, res) => {
  const { me, chats } = req.body;

  try {
    // 1️⃣ Messages delete (both directions)
    await Message.deleteMany({
      $or: [
        { from: me, to: { $in: chats } },
        { from: { $in: chats }, to: me }
      ]
    });

    // 2️⃣ User metadata update (optional)
    await User.updateOne(
      { phone: me },
      { $addToSet: { deletedChats: { $each: chats } } }
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Delete failed" });
  }
});

/**
 * PIN CHATS
 */
router.post("/pin-chats", async (req, res) => {
  const { me, chats } = req.body;

  try {
    await User.updateOne(
      { phone: me },
      { $addToSet: { pinnedChats: { $each: chats } } }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Pin failed" });
  }
});

/**
 * UNPIN CHATS
 */
router.post("/unpin-chats", async (req, res) => {
  const { me, chats } = req.body;

  try {
    await User.updateOne(
      { phone: me },
      { $pull: { pinnedChats: { $in: chats } } }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Unpin failed" });
  }
});

/**
 * MUTE CHATS
 */
router.post("/mute-chats", async (req, res) => {
  const { me, chats } = req.body;

  try {
    await User.updateOne(
      { phone: me },
      { $addToSet: { mutedChats: { $each: chats } } }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Mute failed" });
  }
});


module.exports = router;