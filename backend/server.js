require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Group = require("./models/Group");
const User = require("./models/User");
const Message = require("./models/Message");
const messageRoutes = require("./routes/messages");


const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");


function cleanPhone(p) {
  return String(p || "").replace(/\D/g, "").slice(-10);
}


function normalize(phone) {
  return phone?.replace(/\D/g, "");
}


app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
 
app.use("/api/auth", authRoutes);

 
app.use("/api/messages", messageRoutes);
app.use("/api/users", userRoutes);







//  ================= FRONTEND =================
// app.use(express.static(path.join(__dirname, "../frontend")));

//  ROOT → LOGIN PAGE ONLY
// app.get("/", (req, res) => {
//   res.sendFile(path.join(__dirname, "../frontend/login.html"));
// });

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Backend is running" });
});


// ================= UPLOADS =================
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}
app.use("/uploads", express.static("uploads"));

// ================= MONGODB =================
console.log("ENV MONGO_URI =>", process.env.MONGO_URI);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Atlas connected"))
  .catch(err => console.log("❌ MongoDB error:", err.message));


// ================= MODELS =================
// const User = mongoose.model("User", {
//   phone: { type: String, unique: true },
//   name: String,
//   online: { type: Boolean, default: false },
//   lastSeen: Date,
//   photo: { type: String, default: null },
//   about: String,
//   deletedChats: [String],
//   favourites: { type: [String], default: [] },
//   blocked: { type: [String], default: [] }
// });

// const Message = mongoose.model("Message", {
//   from: String,
//   to: String,
//   text: String,
//   createdAt: { type: Date, default: Date.now },
//   delivered: { type: Boolean, default: false },
//   seen: { type: Boolean, default: false },

//   // 🔥 FILE SUPPORT
//   fileType: String, // "media", "document", "audio"
//   fileName: String,
//   mimeType: String,
//   fileData: String, // base64 data

//   // 🔥 DELETE SUPPORT
//   deletedFor: {
//     type: [String], // phone numbers
//     default: []
//   },
//   deletedForEveryone: {
//     type: Boolean,
//     default: false
//   }
// });




const Status = mongoose.model("Status", {
  phone: String,
  text: String,
  image: String,
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) },
  // who saw and when
  views: {
    type: [
      {
        phone: String,
        viewedAt: { type: Date, default: Date.now }
      }
    ],
    default: []
  }
});

const CallLog = mongoose.model("CallLog", {
  from: String,
  to: String,
  type: { type: String, enum: ["voice", "video"], default: "voice" },
  status: { type: String, enum: ["missed", "ended", "rejected", "ongoing"], default: "ended" },
  duration: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// ================= MULTER =================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads"),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// ================= USERS =================
// legacy users list
app.get("/users/:me", async (req, res) => {
  const me = req.params.me;

  const users = await User.find({
    phone: { $ne: me, $ne: null, $ne: "" }
  });

  const cleanUsers = users.filter(u => u.phone && u.phone !== "null");
  res.json(cleanUsers);
});

// enriched chat list with last message + unread count + favourites
// ===== CHAT LIST API (FIXED & SIMPLE) =====
app.get("/chats/:me", async (req, res) => {
  try {
    const me = cleanPhone(req.params.me);

    const meUser = await User.findOne({ phone: me });
    const deleted = meUser?.deletedChats || [];

    const users = await User.find({
      phone: { $ne: me, $nin: deleted }
    });

    let result = await Promise.all(
      users.map(async u => {
        const other = cleanPhone(u.phone);

        const lastMsg = await Message.findOne({
          $or: [
            { from: me, to: other },
            { from: other, to: me }
          ],
          deletedForEveryone: false,
          deletedFor: { $ne: me }
        }).sort({ createdAt: -1 });

        const unread = await Message.countDocuments({
          from: other,
          to: me,
          seen: false,
          deletedFor: { $ne: me }
        });

        return {
          phone: other,
          name: u.name,
          online: u.online,
          lastMessage: lastMsg?.text || "",
          lastMessageAt: lastMsg?.createdAt || new Date(0),
          unread
        };
      })
    );

    // 🔥 THIS IS THE MAGIC LINE
    result.sort(
      (a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt)
    );

    res.json(result);
  } catch (err) {
    console.error("❌ /chats error:", err.message);
    res.status(500).json([]);
  }
});



// ================= GROUP CHATS =================
app.get("/groups/:me", async (req, res) => {
  const me = req.params.me;

  const groups = await Group.find({
    members: me
  }).sort({ createdAt: -1 });

  res.json(groups);
});
// ================= GROUP CHAT LIST =================
app.get("/group-chats/:me", async (req, res) => {
  try {
    const me = cleanPhone(req.params.me);

    const groups = await Group.find({ members: me });

    const result = await Promise.all(
      groups.map(async g => {
        const lastMsg = await Message.findOne({
          groupId: g._id.toString(),
          deletedForEveryone: false
        }).sort({ createdAt: -1 });

        const unread = await Message.countDocuments({
          groupId: g._id.toString(),
          seen: false,
          from: { $ne: me }
        });

        return {
          _id: g._id,
          name: g.name,
          isGroup: true,
          lastMessage: lastMsg?.text || "",
          lastMessageAt: lastMsg?.createdAt || new Date(0),
          unread
        };
      })
    );

    res.json(result);
  } catch (err) {
    res.status(500).json([]);
  }
});



// ================= PROFILE =================
app.get("/profile/:phone", async (req, res) => {
  const user = await User.findOne({ phone: req.params.phone });
  res.json(user || {});
});

app.post("/profile/upload", upload.single("photo"), async (req, res) => {
  const { phone, about, name } = req.body;

  const photoUrl = req.file
    ? `http://localhost:3000/uploads/${req.file.filename}`
    : undefined;

  const user = await User.findOneAndUpdate(
    { phone },
    {
      ...(photoUrl !== undefined && { photo: photoUrl }),
      ...(about !== undefined && { about }),
      ...(name !== undefined && { name })
    },
    { upsert: true, new: true }
  );

  io.emit("profileUpdated", {
    phone: user.phone,
    photo: user.photo,
    about: user.about,
    name: user.name
  });

  res.json({ success: true });
});

app.post("/profile/remove", async (req, res) => {
  const { phone } = req.body;
  phone = cleanPhone(phone);


  const user = await User.findOneAndUpdate(
    { phone },
    { photo: null },
    { new: true }
  );

  io.emit("profileUpdated", {
    phone: user.phone,
    photo: null,
    name: user.name,
    about: user.about
  });

  res.json({ success: true });
});

// ================= CONTACTS / BLOCK / FAVOURITES =================
app.post("/contacts", async (req, res) => {
  let { phone, name } = req.body;
phone = cleanPhone(phone);

  if (!phone) return res.status(400).json({ error: "phone required" });

  const contact = await User.findOneAndUpdate(
    { phone },
    { $set: { phone, ...(name ? { name } : {}) } },
    { upsert: true, new: true }
  );

  // Emit refresh to update chat list
  io.emit("refreshChatList");
  res.json(contact);
});

// Get all contacts for a user (users with messages or explicitly added)
app.get("/contacts/:me", async (req, res) => {
  const me = req.params.me;
  
  // Get all users except self
  const users = await User.find({
    phone: { $ne: me, $ne: null, $ne: "" }
  });
  
  const contacts = users.map(u => ({
    phone: u.phone,
    name: u.name,
    photo: u.photo,
    about: u.about
  }));
  
  res.json(contacts);
});

app.post("/block", async (req, res) => {
  const { me, target, block } = req.body;
  if (!me || !target) return res.status(400).json({ error: "missing" });

  const update = block
    ? { $addToSet: { blocked: target } }
    : { $pull: { blocked: target } };

  const user = await User.findOneAndUpdate(
    { phone: me },
    update,
    { upsert: true, new: true }
  );

  res.json({ blocked: user.blocked });
});

app.get("/block/:me", async (req, res) => {
  const user = await User.findOne({ phone: req.params.me });
  res.json(user?.blocked || []);
});

app.post("/favourites/toggle", async (req, res) => {
  const { me, target, add } = req.body;
  if (!me || !target) return res.status(400).json({ error: "missing" });

  const update = add
    ? { $addToSet: { favourites: target } }
    : { $pull: { favourites: target } };

  const user = await User.findOneAndUpdate(
    { phone: me },
    update,
    { upsert: true, new: true }
  );

  res.json({ favourites: user.favourites });
});

app.get("/favourites/:me", async (req, res) => {
  const user = await User.findOne({ phone: req.params.me });
  res.json(user?.favourites || []);
});

// ================= STATUS =================
function cleanupStatuses() {
  Status.deleteMany({ expiresAt: { $lte: new Date() } }).catch(() => {});
}

app.get("/status/feed/:me", async (req, res) => {
  cleanupStatuses();
  const me = req.params.me;
  const now = new Date();
  const feed = await Status.find({ expiresAt: { $gt: now } }).sort({
    createdAt: -1
  });
  const owners = feed.map(s => s.phone).filter(Boolean);
  const ownerDocs = await User.find({ phone: { $in: owners } });
  const ownerBlockedMap = Object.fromEntries(
    ownerDocs.map(u => [u.phone, u.blocked || []])
  );
  const meDoc = await User.findOne({ phone: me });
  const myBlocked = meDoc?.blocked || [];

  const visible = feed.filter(s => {
    if (!s.phone || s.phone === "null") return false;
    if (myBlocked.includes(s.phone)) return false;
    const otherBlockedMe = ownerBlockedMap[s.phone]?.includes(me);
    if (otherBlockedMe) return false;
    return true;
  });

  res.json(visible);
});

app.post("/status", async (req, res) => {
  cleanupStatuses();
  const { phone, text, image } = req.body;
  const status = await Status.create({
    phone,
    text,
    image: image || null
  });
  io.emit("statusNew", status);
  res.json(status);
});

app.post("/status/view", async (req, res) => {
  const { phone, statusId } = req.body;
  const status = await Status.findById(statusId);
  if (!status) return res.json({ success: false });

  const existing = status.views.find(v => v.phone === phone);
  if (existing) {
    existing.viewedAt = new Date();
  } else {
    status.views.push({ phone, viewedAt: new Date() });
  }
  await status.save();

  io.emit("statusViewed", { statusId, by: phone, at: new Date() });
  res.json({ success: true, views: status.views.length });
});

app.get("/status/:id/views", async (req, res) => {
  const status = await Status.findById(req.params.id);
  res.json(status?.views || []);
});

app.post("/status/delete", async (req, res) => {
  const { phone, statusId } = req.body;
  const status = await Status.findById(statusId);
  if (!status) return res.status(404).json({ error: "not found" });
  if (status.phone !== phone) return res.status(403).json({ error: "forbidden" });

  await Status.findByIdAndDelete(statusId);
  io.emit("statusDeleted", { statusId });
  res.json({ success: true });
});

// ================= CHAT READ STATE =================
app.post("/chats/mark-read", async (req, res) => {
  const { me, other } = req.body;
  if (!me || !other) return res.status(400).json({ error: "missing" });

  await Message.updateMany(
    { from: other, to: me, seen: false, deletedForEveryone: false, deletedFor: { $ne: me } },
    { $set: { seen: true } }
  );

  io.to(other).emit("messageSeen", { by: me });
  res.json({ success: true });
});

app.post("/chats/mark-unread", async (req, res) => {
  const { me, other } = req.body;
  if (!me || !other) return res.status(400).json({ error: "missing" });

  await Message.findOneAndUpdate(
    { from: other, to: me, deletedForEveryone: false, deletedFor: { $ne: me } },
    { $set: { seen: false } },
    { sort: { createdAt: -1 } }
  );

  io.emit("refreshChatList");
  res.json({ success: true });
});

// ================= CLEAR ALL CHATS (PERMANENT) =================
app.post("/api/chats/clear", async (req, res) => {
  try {
    let { me } = req.body;
    me = cleanPhone(me);

    await Message.deleteMany({
      $or: [{ from: me }, { to: me }]
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Clear chats error:", err.message);
    res.status(500).json({ error: "Failed to clear chats" });
  }
});

// ================= DELETE ALL CHATS (FULL WIPE) =================
app.post("/api/chats/delete-all", async (req, res) => {
  try {
    let { me } = req.body;
    me = cleanPhone(me);

    await Message.deleteMany({
      $or: [{ from: me }, { to: me }]
    });

    await User.findOneAndUpdate(
      { phone: me },
      { $set: { deletedChats: [] } }
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Delete chats error:", err.message);
    res.status(500).json({ error: "Failed to delete chats" });
  }
});

// persist deleted chats so they don't re-appear in the list
app.post("/chats/delete", async (req, res) => {
  const { me, other } = req.body;
  if (!me || !other) return res.status(400).json({ error: "missing" });

  const user = await User.findOneAndUpdate(
    { phone: me },
    { $addToSet: { deletedChats: other } },
    { upsert: true, new: true }
  );

  io.to(me).emit("refreshChatList");
  res.json({ success: true, deletedChats: user.deletedChats });
});

// ================= CALL LOGS =================
app.get("/calls/:me", async (req, res) => {
  const me = req.params.me;
  const calls = await CallLog.find({
    $or: [{ from: me }, { to: me }]
  })
    .sort({ createdAt: -1 })
    .limit(50);
  res.json(calls);
});

app.post("/calls/log", async (req, res) => {
  const payload = req.body;
  const saved = await CallLog.create(payload);
  res.json(saved);
});

// ================= SOCKET =================
io.on("connection", socket => {
  let phone = null;

socket.on("join", async p => {
  p = cleanPhone(p);   // 🔥 yahin number clean hoga
  phone = p;           // 🔥 server ke liye stored
  socket.join(p);      // 🔥 room bhi clean number ka


    await User.findOneAndUpdate(
      { phone: p },
      { online: true },
      { upsert: true }
    );

    socket.on("joinGroupRoom", roomId => {
  socket.join(roomId);
  console.log("📦 Joined group room:", roomId);
});


    // 🔥 join all groups of user
const groups = await Group.find({ members: p });
groups.forEach(g => {
  socket.join(g._id.toString());
});


    socket.broadcast.emit("userOnline", p);
  });

  socket.on("getStatus", async targetPhone => {
    const user = await User.findOne({ phone: targetPhone });
    socket.emit("statusResponse", {
      phone: targetPhone,
      online: user?.online || false,
      lastSeen: user?.lastSeen || null
    });
  });

  // ================= GROUP CREATE =================
socket.on("createGroup", async ({ name, members, createdBy }) => {
  try {
    const allMembers = Array.from(new Set([...members, createdBy]));

    const group = await Group.create({
      name,
      members: allMembers,
      createdBy
    });

    // 🔥 sab members ko group bhejo
    allMembers.forEach(phone => {
      io.to(phone).emit("groupCreated", group);
    });

    // 🔥 sab members ko group room me join karao
allMembers.forEach(phone => {
  io.to(phone).emit("joinGroupRoom", group._id.toString());
});



  } catch (err) {
    console.error("Group create error:", err.message);
  }
});

// ================= FILE SEND (FINAL – CORRECT) =================
socket.on("sendFile", async data => {

  // 🔹 PERSONAL CHAT
  if (!data.isGroup) {
    // 🔥 BLOCKING CHECK (like messages)
    const sender = await User.findOne({ phone: data.from });
    const receiver = await User.findOne({ phone: data.to });

    const blockedByReceiver = receiver?.blocked?.includes?.(data.from);
    const senderHasBlocked = sender?.blocked?.includes?.(data.to);
    
    if (blockedByReceiver || senderHasBlocked) {
      socket.emit("messageBlocked", {
        to: data.to,
        reason: blockedByReceiver ? "blocked-by-target" : "you-blocked-target"
      });
      return;
    }

    // 🔥 Save file to database for persistence
    const fileMessage = await Message.create({
      from: data.from,
      to: data.to,
      text: `📎 ${data.fileName}`,
      fileType: data.fileType,
      fileName: data.fileName,
      mimeType: data.mimeType,
      fileData: data.data,
      createdAt: new Date(data.createdAt || Date.now()),
      delivered: true,
      seen: false
    });

    // 🔥 Prepare file data for emission
   const fileDataToSend = fileMessage.toObject();



    // 🔥 Emit to recipient
    console.log(`📤 Sending file to recipient: ${data.to}`);
    io.to(data.to).emit("receiveFile", fileDataToSend);
    
    // 🔥 Emit to sender (confirmation)
    console.log(`📤 Sending file confirmation to sender: ${data.from}`);
    socket.emit("receiveFile", fileDataToSend);
    

    
    // 🔥 Refresh chat list
    io.emit("refreshChatList");
    return;
  }

// 🔹 GROUP CHAT FILE SAVE (🔥 FIXED)
const groupId = data.to;
const group = await Group.findById(groupId);
if (!group) return;

// 🔥 DB me save
const fileMessage = await Message.create({
  from: data.from,
  to: null,                  // 🔥 IMPORTANT
  groupId: groupId,          // 🔥 IMPORTANT
  text: `📎 ${data.fileName}`,
  fileType: data.fileType,
  fileName: data.fileName,
  mimeType: data.mimeType,
  fileData: data.data,
  createdAt: new Date(),
  delivered: true,
  seen: false,
  deletedFor: [],
  deletedForEveryone: false
});

// 🔥 sab members ko bhejo + chat list refresh
group.members.forEach(phone => {
  io.to(phone).emit("receiveGroupMessage", fileMessage);
  io.to(phone).emit("refreshChatList"); // 🔥 YE MISS THA
});


});

socket.on("markSeen", async ({ from, to }) => {
  try {
    from = cleanPhone(from);
    to   = cleanPhone(to);

    console.log("👀 Marking seen:", from, "->", to);

    const result = await Message.updateMany(
      { from, to, seen: false },
      { $set: { seen: true } }
    );

    console.log("✅ Seen updated:", result.modifiedCount);

    // 🔥 Blue tick update
    io.to(from).emit("messagesSeen", { from, to });

    // 🔥 VERY IMPORTANT: refresh chat list for BOTH users
    io.to(from).emit("refreshChatList");
    io.to(to).emit("refreshChatList");

  } catch (err) {
    console.error("❌ markSeen error:", err.message);
  }
});


socket.on("sendMessage", async ({ from, to, text }) => {
  try {
    from = cleanPhone(from);
    to = cleanPhone(to);

    if (!text) return;

    const message = await Message.create({
      from,
      to,
      text,
      createdAt: new Date(),
      delivered: true,
      seen: false,
      deletedFor: [],
      deletedForEveryone: false
    });

    // sender ko
    socket.emit("messageSent", message);

    // receiver ko
    io.to(to).emit("receiveMessage", message);

    io.to(from).emit("refreshChatList");
    io.to(to).emit("refreshChatList");

    console.log("✅ MESSAGE SAVED:", message.text);
  } catch (err) {
    console.error("❌ sendMessage error:", err.message);
  }
});


  // ================= GROUP MESSAGE =================
socket.on("sendGroupMessage", async ({ groupId, from, text }) => {
  try {
    if (!text || !groupId) return;

    // 🔥 DB me SAVE
   const message = await Message.create({
  from,
  to: null,                  // ✅ ADD THIS
  groupId,                   // ✅ group id
  text,
  createdAt: new Date(),
  delivered: true,
  seen: false,
  deletedFor: [],
  deletedForEveryone: false
});


    const group = await Group.findById(groupId);
    if (!group) return;

    // 🔥 group ke sab members ko bhejo
    group.members.forEach(phone => {
  io.to(phone).emit("receiveGroupMessage", message);
  io.to(phone).emit("refreshChatList");   // 🔥 ADD THIS
});


  } catch (err) {
    console.error("❌ group msg error:", err.message);
  }
});




  // 🔥 DELETE FOR ME
  socket.on("deleteForMe", async ({ messageId, phone }) => {
    
    await Message.findByIdAndUpdate(messageId, {
      $addToSet: { deletedFor: phone }
    });
  });

// 🔥 DELETE FOR EVERYONE (FINAL – WhatsApp Style)
socket.on("deleteForEveryone", async ({ messageId }) => {
  try {
    const msg = await Message.findByIdAndUpdate(
      messageId,
      {
        text: "This message was deleted",
        deletedForEveryone: true
      },
      { new: true }
    );

    if (!msg) return;

    // 🔥 send update to both users
    io.to(msg.from).emit("messageDeletedEveryone", msg);
    io.to(msg.to).emit("messageDeletedEveryone", msg);

    console.log("🗑️ Deleted for everyone:", msg._id);
  } catch (err) {
    console.error("❌ deleteForEveryone error:", err.message);
  }
});


  socket.on("typing", ({ from, to }) => {
    io.to(to).emit("typing", { from });
  });

  socket.on("stopTyping", ({ from, to }) => {
    io.to(to).emit("stopTyping", { from });
  });

  // ================= CALLS (SIGNAL) =================
  socket.on("call:start", data => {
    // data: { from, to, type }
    io.to(data.to).emit("call:incoming", data);
  });

  socket.on("call:accept", data => {
    // data: { from, to }
    io.to(data.to).emit("call:accepted", data);
  });

  socket.on("call:reject", data => {
    io.to(data.to).emit("call:rejected", data);
  });

  socket.on("call:end", data => {
    io.to(data.to).emit("call:ended", data);
  });

  socket.on("disconnect", async () => {
    if (!phone) return;

    const lastSeen = new Date();

    await User.findOneAndUpdate(
      { phone },
      { online: false, lastSeen }
    );

    socket.broadcast.emit("userOffline", { phone, lastSeen });
  });
});

// ================= ERROR HANDLING =================
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// ================= START =================
server.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});