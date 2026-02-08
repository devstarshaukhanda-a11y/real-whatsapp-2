// ================= GROUP SOCKET HANDLERS =================

// 🔥 GROUP CREATED (FOR ALL MEMBERS)
socket.on("groupCreated", group => {
  console.log("✅ Group received:", group);

  const groupKey = `wa-groups-${myPhone}`;
  let groups = JSON.parse(localStorage.getItem(groupKey) || "[]");

  const groupId = group.id || group._id || group.name;

  // ✅ duplicate avoid
  if (!groups.some(g => (g.id || g._id || g.name) === groupId)) {
    groups.unshift({
      ...group,
      id: groupId
    });
    localStorage.setItem(groupKey, JSON.stringify(groups));
  }

  // UI refresh
  if (typeof renderGroups === "function") renderGroups();
  if (typeof renderGroupChatsIntoChatList === "function") {
    renderGroupChatsIntoChatList();
  }
});


// 🔥 GROUP MESSAGE RECEIVE
socket.on("receiveGroupMessage", msg => {
  console.log("📩 Group message:", msg);

  const msgKey = `wa-group-msgs-${myPhone}`;
  const store = JSON.parse(localStorage.getItem(msgKey) || "{}");

  if (!store[msg.groupId]) store[msg.groupId] = [];
  store[msg.groupId].push(msg);

  localStorage.setItem(msgKey, JSON.stringify(store));

  // 🔥 current open group chat
  if (window.currentChat === msg.groupId) {
    if (typeof renderMessage === "function") {
      renderMessage(msg);
    }
  }

  if (typeof updateGroupPreview === "function") {
    updateGroupPreview(msg.groupId, msg);
  }
});
