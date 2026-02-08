const express = require("express");
const router = express.Router();

/*
  TEMP STORAGE
  baad me MongoDB / MySQL lagega
*/
const groups = [];

/*
  CREATE GROUP
*/
router.post("/create", (req, res) => {
  const { name, members } = req.body;

  if (!name || !members || members.length === 0) {
    return res.json({ success: false });
  }

  const group = {
    id: "grp_" + Date.now(),
    name,
    members,
    lastMessage: "",
    unread: 0,
    isGroup: true
  };

  groups.push(group);

  console.log("✅ GROUP CREATED:", group);

  res.json({ success: true, group });
});

/*
  GET GROUPS FOR USER
*/
router.get("/:phone", (req, res) => {
  const phone = req.params.phone;

  const userGroups = groups.filter(g =>
    g.members.includes(phone)
  );

  res.json(userGroups);
});

module.exports = router;
