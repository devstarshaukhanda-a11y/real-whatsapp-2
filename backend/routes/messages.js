const express = require("express");
const router = express.Router();
const Message = require("../models/Message");

function cleanPhone(p) {
  return String(p || "").replace(/\D/g, "").slice(-10);
}

/* ===============================
   SEND PERSONAL MESSAGE
================================ */
router.post("/send", async (req, res) => {
  try {
    let { from, to, text } = req.body;

    if (!from || !to || !text) {
      return res.status(400).json({ error: "missing fields" });
    }

    from = cleanPhone(from);
    to = cleanPhone(to);

    const msg = await Message.create({
      from,
      to,
      text,
      createdAt: new Date(),
      delivered: true,
      seen: false
    });

    res.json({ success: true, message: msg });
  } catch (err) {
    console.error("SEND ERROR:", err.message);
    res.status(500).json({ error: "send failed" });
  }
});

/* ===============================
   🔥 LOAD GROUP CHAT MESSAGES
   🔥 MUST BE ABOVE :u1/:u2
================================ */
router.get("/group/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;

    const msgs = await Message.find({
      groupId,
      deletedForEveryone: false
    }).sort({ createdAt: 1 });

    res.json(msgs);
  } catch (err) {
    console.error("GROUP LOAD ERROR:", err.message);
    res.status(500).json([]);
  }
});

/* ===============================
   LOAD PERSONAL CHAT
================================ */
router.get("/:u1/:u2", async (req, res) => {
  try {
    const u1 = cleanPhone(req.params.u1);
    const u2 = cleanPhone(req.params.u2);

    const msgs = await Message.find({
      $or: [
        { from: u1, to: u2 },
        { from: u2, to: u1 }
      ]
    }).sort({ createdAt: 1 });

    res.json(msgs);
  } catch (err) {
    console.error("LOAD ERROR:", err.message);
    res.status(500).json([]);
  }
});

module.exports = router;
