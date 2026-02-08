// ================= USER PHONE (MUST BE FIRST) =================
const myPhone = localStorage.getItem("phone") || prompt("Enter phone number");
localStorage.setItem("phone", myPhone);

import { io } from "socket.io-client";

const socket = io("https://whatsapp-chat.leavecode.co.in", {
  query: { phone: myPhone },     // user identify
  transports: ["websocket"],     // 🔥 force websocket
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});


socket.on("connect", () => {
  console.log("Connected to server");
  if (myPhone) socket.emit("join", myPhone);
});

// ================= GROUP FROM SERVER =================
socket.on("groupCreated", group => {
  console.log("✅ Group received:", group);

  if (!group || !group._id) return;

  // 🔥 ENSURE groups is loaded
  if (!Array.isArray(groups)) {
    groups = loadJSON(groupKey, []);
  }

  // duplicate avoid
  if (groups.find(g => (g.id || g._id) === group._id)) return;

  const newGroup = {
    id: group._id,              // 🔥 MUST
    name: group.name,
    members: group.members || [],
    createdAt: group.createdAt || Date.now()
  };

  groups.unshift(newGroup);

  // 🔥 SAVE + RENDER
  localStorage.setItem(groupKey, JSON.stringify(groups));
  renderGroups();
  renderGroupChatsIntoChatList();
});



socket.on('disconnect', (reason) => {
  console.log('Disconnected from server:', reason);
  // Optionally show a message to user
  // alert('Connection lost. Reconnecting...');
});

socket.on('reconnect', (attemptNumber) => {
  console.log('Reconnected after', attemptNumber, 'attempts');
});

socket.on('reconnect_failed', () => {
  console.log('Failed to reconnect');
  // alert('Unable to reconnect. Please refresh the page.');
});

let currentChat = null;
let typingTimer = null;
const chatPrefsKey = `wa-chat-prefs-${myPhone}`;
let chatPrefs = {};
// chats that user has deleted locally (hide from list & keep hidden on refresh)
const hiddenChatsKey = `wa-hidden-chats-${myPhone}`;
let hiddenChats = [];
// runtime state synced with backend
let chatState = {};
let cachedUsers = [];
let currentChatMeta = null;

let chatList, messagesBox, chatUserName, chatUserAvatar, chatUserStatus, messageInput, sendBtn;

// local-only group chats messages
const groupMessagesKey = `wa-group-msgs-${myPhone}`;
let groupMessages = loadJSON(groupMessagesKey, {});

function saveGroupMessages() {
  localStorage.setItem(groupMessagesKey, JSON.stringify(groupMessages));
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

// Initialize chatPrefs and hiddenChats
try {
  chatPrefs = loadJSON(chatPrefsKey, {});
  hiddenChats = loadJSON(hiddenChatsKey, []);
} catch (e) {
  chatPrefs = {};
  hiddenChats = [];
}

function uid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

/* 🔥 DEFAULT AVATAR (ONLY WHEN NEVER SET) */
const defaultAvatar = phone =>
  `https://i.pravatar.cc/150?u=${phone}`;

const firstLetter = (name, phone) =>
  (name || phone || "?").trim().charAt(0).toUpperCase();

const getAvatarColor = (initial) => {
  const colors = ['#25d366', '#ff5722', '#2196f3', '#ff9800', '#9c27b0', '#00bcd4', '#4caf50', '#f44336'];
  return colors[initial.charCodeAt(0) % colors.length];
};

// Initialize everything when DOM is ready
function initApp() {

  // 🔥 LOAD GROUPS FROM SERVER ON LOGIN
fetch(`http://localhost:3000/groups/${myPhone}`)
  .then(res => res.json())
  .then(serverGroups => {
    // overwrite local groups with server truth
    groups = serverGroups.map(g => ({
      id: g._id,
      name: g.name,
      members: g.members,
      createdAt: g.createdAt
    }));

    saveGroups(); // localStorage + render
  })
  .catch(err => {
    console.error("Group load error:", err);
  });

  // Get DOM elements
  chatList = document.getElementById("chatItems");
  messagesBox = document.getElementById("messages");
  chatUserName = document.getElementById("chatUserName");
  chatUserAvatar = document.getElementById("chatUserAvatar");
  chatUserStatus = document.getElementById("chatUserStatus");
  messageInput = document.getElementById("messageInput");
  sendBtn = document.getElementById("sendBtn");
  
  // Initialize send button
  if (sendBtn) {
    sendBtn.onclick = sendMessage;
  }
  
  // Initialize Enter key
  if (messageInput) {
    messageInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }
  
  // Initialize sidebar buttons
  const btnChat = document.getElementById("btn-chat");
  const btnCalls = document.getElementById("btn-calls");
  const btnStatus = document.getElementById("btn-status");
  const btnCommunities = document.getElementById("btn-communities");
  const btnSettings = document.getElementById("btn-settings");
  const btnProfile = document.getElementById("btn-profile");
  const screens = document.querySelectorAll(".screen");
  const sidebarIcons = document.querySelectorAll(".wa-icon");
  
  function activateSidebar(el) {
    sidebarIcons.forEach(i => i.classList.remove("active"));
    el?.classList.add("active");
  }
  
  function showScreen(screen) {
    screens.forEach(s => s.classList.add("hidden"));
    document.querySelector(`.${screen}-screen`)?.classList.remove("hidden");
  }
  
  btnChat?.addEventListener("click", () => {
    activateSidebar(btnChat);
    showScreen("chat");
  });
  
  btnCalls?.addEventListener("click", () => {
    activateSidebar(btnCalls);
    showScreen("calls");
  });
  
  btnStatus?.addEventListener("click", () => {
    activateSidebar(btnStatus);
    showScreen("status");
  });
  
  btnCommunities?.addEventListener("click", () => {
    activateSidebar(btnCommunities);
    showScreen("communities");
  });
  
  btnSettings?.addEventListener("click", () => {
    activateSidebar(btnSettings);
    showScreen("settings");
  });
  
  btnProfile?.addEventListener("click", () => {
    openProfile();
    activateSidebar(btnProfile);
  });
  
  // Store btnChat globally for refreshGlobalUnreadIndicator
  window.btnChat = btnChat;
  
  // Load users
  // Chat header search functionality (FIXED – SAME LOGIC)
let chatSearchActive = false;

const chatHeaderActions = document.querySelector(".chat-header-actions");
if (chatHeaderActions) {
  const searchIcon = Array.from(
    chatHeaderActions.querySelectorAll(".material-icons")
  ).find(icon => icon.textContent.trim() === "search");

  if (searchIcon) {
    searchIcon.style.cursor = "pointer";

    searchIcon.addEventListener("click", () => {
      if (!currentChat || chatSearchActive) return;

      chatSearchActive = true;

      const searchOverlay = document.createElement("div");
      searchOverlay.id = "chatSearchOverlay";
      searchOverlay.style.cssText =
        "position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:2000";

      searchOverlay.innerHTML = `
        <div style="background:#fff;width:500px;max-width:90%;max-height:80vh;border-radius:12px;padding:20px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h3 style="margin:0">Search in chat</h3>
            <span class="material-icons" id="closeChatSearch" style="cursor:pointer">close</span>
          </div>
          <input id="chatSearchInput" placeholder="Search messages..."
            style="padding:10px;border-radius:8px;border:1px solid #d0d7dc;width:100%">
          <div id="chatSearchResults"
            style="max-height:400px;overflow-y:auto;border:1px solid #e0e0e0;border-radius:8px;padding:8px"></div>
        </div>
      `;

      document.body.appendChild(searchOverlay);

      const closeBtn = document.getElementById("closeChatSearch");

      closeBtn.onclick = () => {
        searchOverlay.remove();
        chatSearchActive = false;
      };

      searchOverlay.onclick = e => {
        if (e.target === searchOverlay) {
          searchOverlay.remove();
          chatSearchActive = false;
        }
      };
    });
  }
}
  loadUsers();
  
  // Load initial profile
  fetch(`http://localhost:3000/profile/${myPhone}`)
    .then(res => res.json())
    .then(user => {
      const sidebarImg = document.querySelector(".wa-profile img");
      if (sidebarImg) {
        sidebarImg.src = user.photo === null ? defaultAvatar(myPhone) : user.photo || defaultAvatar(myPhone);
      }
    })
    .catch(() => {});
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

/* ================= LOAD USERS ================= */
async function loadUsers() {
  const res = await fetch(`http://localhost:3000/chats/${myPhone}`);
  const users = await res.json();
  cachedUsers = users;

  chatState = {};
  document.querySelectorAll(".chat").forEach(e => e.remove());

  const ordered = users
    // skip chats user has deleted locally
    .filter(u => !hiddenChats.includes(u.phone))
    .map(u => ({ ...u, prefs: chatPrefs[u.phone] || {} }))
    .sort((a, b) => {
      const aPinned = a.prefs.pinned ? 1 : 0;
      const bPinned = b.prefs.pinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;

      const aArchived = a.prefs.archived ? 1 : 0;
      const bArchived = b.prefs.archived ? 1 : 0;
      if (aArchived !== bArchived) return aArchived - bArchived;

      const aTime = new Date(a.lastMessageAt || 0).getTime();
      const bTime = new Date(b.lastMessageAt || 0).getTime();
      return bTime - aTime;
    });

  ordered.forEach(u => {
    if (!u.phone || u.phone === "null") return;

    chatState[u.phone] = {
      blocked: !!u.blocked,
      blockedBy: !!u.blockedBy,
      favourite: !!u.favourite
    };

    const div = document.createElement("div");
    div.className = "chat";
    div.dataset.phone = u.phone;
    div.dataset.last = new Date(u.lastMessageAt || 0).getTime();

    let photo = "";
    if (u.photo) {
      photo = u.photo;
    }

    const name = (u.name && u.name.trim()) || u.phone;
    const initial = firstLetter(name, u.phone);
    const avatarColor = getAvatarColor(initial);
    const infoText = u.blocked
      ? "Blocked"
      : u.blockedBy
      ? "Blocked you"
      : u.lastMessage || "";
    const lastTime = u.lastMessageAt
      ? new Date(u.lastMessageAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        })
      : "";

    div.innerHTML = `
      <div class="chat-avatar">
        ${photo ? `<img src="${photo}">` : `<div class="blank-avatar" style="background: ${avatarColor}">${initial}</div>`}
      </div>
      <div class="chat-info">
        <b>${name}</b>
        <div class="chat-status">${infoText}</div>
      </div>
      <div class="chat-meta">
        <span class="time">${lastTime}</span>
        ${u.unread ? `<span class="unread-badge">${u.unread}</span>` : ""}
      </div>
    `;

    div.onclick = () => openChat(u);
    div.oncontextmenu = e => {
      e.preventDefault();
      showChatMenu(e.pageX, e.pageY, u, div);
    };
    applyChatPrefs(div, u.phone, {
      blocked: u.blocked,
      favourite: u.favourite,
      unread: !!u.unread
    });
    if (chatList) {
      chatList.appendChild(div);
    }
  });

  if (chatList) {
    reorderChatList();
  }

  // also inject local groups into chat list
  if (typeof renderGroupChatsIntoChatList === "function") {
    renderGroupChatsIntoChatList();
  }
}

/* ================= OPEN CHAT ================= */
async function openChat(user) {
  currentChat = user.phone;
  currentChatMeta = user;

  chatUserName.innerText = user.name || user.phone;

  chatUserAvatar.src =
    user.photo === null
      ? defaultAvatar(user.phone)
      : user.photo || defaultAvatar(user.phone);

  chatUserStatus.innerText = "";
  messagesBox.innerHTML = "";

  const state = chatState[user.phone] || {};
  const blockedEither = state.blocked || state.blockedBy;
  sendBtn.disabled = !!state.blocked;
  if (blockedEither) {
    chatUserStatus.innerText = state.blocked
      ? "You blocked this contact"
      : "This contact blocked you";
  }

  socket.emit("getStatus", user.phone);

  // clear unread badge + mark as read when chat is opened
  const node = document.querySelector(`.chat[data-phone="${user.phone}"]`);
  if (node) {
    node.querySelector(".unread-badge")?.remove();
    markChatRead(user.phone, node);
  }
  updateChatActionMenu(chatState[user.phone] || {}, user.isGroup);
  if (!state.blocked) {
    socket.emit("markSeen", { me: myPhone, other: user.phone });
  }

  const res = await fetch(
    `http://localhost:3000/messages/${myPhone}/${user.phone}`
  );
  const msgs = await res.json();
  msgs.forEach(msg => {
    // Check if message is a file (has fileType or fileData)
    if (msg.fileType || msg.fileData) {
      // Convert database format to file message format
      renderFileMessage({
        ...msg,
        data: msg.fileData || msg.data, // Support both formats
        createdAt: msg.createdAt || new Date()
      });
    } else {
      renderMessage(msg);
    }
  });

 const userEl = document.querySelector('.user');
if (userEl) {
  userEl.onclick = () => openContactInfo(user);
}

}

// group chat open (local only, WhatsApp-style UI)
function openGroupChat(group) {
  const groupId = group.id || group._id;
  currentChat = groupId;
  currentChatMeta = { ...group, isGroup: true, id: groupId };

  chatUserName.innerText = group.name;
  chatUserAvatar.src = "";
  chatUserAvatar.alt = "";
  chatUserStatus.innerText = `${group.members?.length || 0} participants`;
  messagesBox.innerHTML = "";

  updateChatActionMenu({}, true);

  const msgs = groupMessages[groupId] || [];
  msgs.forEach(renderMessage);
}

// WhatsApp-style Group info panel (local groups only)
function openGroupInfo(group) {
  if (!group) return;

  const groupId = group.id || group.name;
  const members = group.members || [];

  // resolve member display data from cached users when possible
  const memberRows = members.map(phone => {
    const u = cachedUsers.find(x => x.phone === phone) || {};
    const name = u.name || phone;
    const subtitle = u.about || "Hey there! I am using WhatsApp.";
    const initial = firstLetter(name, phone);
    return `
      <div class="group-member-row">
        <div class="group-member-avatar">
          ${u.photo ? `<img src="${u.photo}">` : `<div class="blank-avatar">${initial}</div>`}
        </div>
        <div class="group-member-meta">
          <div class="group-member-name">${name}</div>
          <div class="group-member-about">${subtitle}</div>
        </div>
        <button class="btn danger remove-member" data-phone="${phone}">Remove</button>
      </div>
    `;
  }).join("") || `<div class="empty">No members added yet.</div>`;

  const overlay = document.createElement("div");
  overlay.id = "groupInfoOverlay";
  overlay.className = "group-info-overlay";
  overlay.innerHTML = `
    <div class="group-info-card">
      <div class="group-info-header">
        <span class="material-icons group-info-close" id="groupInfoCloseBtn">close</span>
        <span class="group-info-title">Group info</span>
      </div>
      <div class="group-info-body">
        <div class="group-info-top">
          <div class="group-info-avatar">
            ${group.icon ? `<img src="${group.icon}">` : `<div class="blank-avatar large">${(group.name || groupId).slice(0, 2).toUpperCase()}</div>`}
          </div>
          <div class="group-info-text">
            <div class="group-info-name">${group.name}</div>
            <div class="group-info-participants">${members.length} participants</div>
            <button class="btn secondary group-info-add-icon" type="button" id="changeIconBtn">Change group icon</button>
            <button class="btn secondary" type="button" id="changeNameBtn">Change group name</button>
          </div>
        </div>

        ${group.description ? `
        <div class="group-info-row">
          <span class="material-icons">info</span>
          <div class="group-info-row-text">
            <div class="group-info-row-title">Group description</div>
            <div class="group-info-row-sub">${group.description}</div>
          </div>
        </div>
        ` : `
        <button class="group-info-row" type="button" id="addDescriptionBtn">
          <span class="material-icons">edit</span>
          <div class="group-info-row-text">
            <div class="group-info-row-title">Add group description</div>
            <div class="group-info-row-sub">Let everyone know what this group is about.</div>
          </div>
        </button>
        `}

        <div class="group-info-section">
          <div class="group-info-section-title">Participants</div>
          ${memberRows}
          <button class="group-info-row" type="button" id="addMemberBtn">
            <span class="material-icons">group_add</span>
            <div class="group-info-row-text">
              <div class="group-info-row-title">Add member</div>
              <div class="group-info-row-sub">Choose from your chats</div>
            </div>
          </button>
        </div>

        <button class="group-info-row group-info-exit" type="button" id="groupInfoExitBtn">
          <span class="material-icons">exit_to_app</span>
          <div class="group-info-row-text">
            <div class="group-info-row-title">Exit group</div>
          </div>
        </button>
      </div>
    </div>
  `;

  document.getElementById("groupInfoOverlay")?.remove();
  document.body.appendChild(overlay);

  document.getElementById("groupInfoCloseBtn")?.addEventListener("click", () => {
    document.getElementById("groupInfoOverlay")?.remove();
  });

  document.getElementById("groupInfoExitBtn")?.addEventListener("click", () => {
    const idx = groups.findIndex(g => (g.id || g.name) === groupId);
    if (idx !== -1) {
      groups.splice(idx, 1);
      saveGroups();
      if (currentChat === groupId) {
        closeChat();
      }
    }
    document.getElementById("groupInfoOverlay")?.remove();
  });

  document.getElementById("addMemberBtn")?.addEventListener("click", () => {
    openMemberPicker({
      selected: members,
      title: `Add members to ${group.name}`,
      onSave: phones => {
        const idx = groups.findIndex(g => (g.id || g.name) === groupId);
        if (idx !== -1) {
          groups[idx].members = Array.from(new Set([...groups[idx].members, ...phones]));
          saveGroups();
          openGroupInfo(groups[idx]);
        }
      }
    });
  });

  document.getElementById("changeNameBtn")?.addEventListener("click", () => {
    const newName = prompt('Enter new group name', group.name);
    if (newName && newName.trim()) {
      const idx = groups.findIndex(g => (g.id || g.name) === groupId);
      if (idx !== -1) {
        groups[idx].name = newName.trim();
        saveGroups();
        openGroupInfo(groups[idx]);
      }
    }
  });

  document.getElementById("changeIconBtn")?.addEventListener("click", () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const idx = groups.findIndex(g => (g.id || g.name) === groupId);
          if (idx !== -1) {
            groups[idx].icon = event.target.result;
            saveGroups();
            openGroupInfo(groups[idx]);
          }
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  });

  document.querySelectorAll('.remove-member').forEach(btn => {
    btn.addEventListener('click', () => {
      const phone = btn.dataset.phone;
      const idx = groups.findIndex(g => (g.id || g.name) === groupId);
      if (idx !== -1) {
        groups[idx].members = groups[idx].members.filter(p => p !== phone);
        saveGroups();
        openGroupInfo(groups[idx]);
      }
    });
  });

  document.getElementById("addDescriptionBtn")?.addEventListener('click', () => {
    const desc = prompt('Enter group description');
    if (desc && desc.trim()) {
      const idx = groups.findIndex(g => (g.id || g.name) === groupId);
      if (idx !== -1) {
        groups[idx].description = desc.trim();
        saveGroups();
        openGroupInfo(groups[idx]);
      }
    }
  });
}

/* ================= STATUS ================= */
socket.on("statusResponse", data => {
  if (data.phone !== currentChat) return;

  if (data.online) {
    chatUserStatus.innerText = "online";
    return;
  }

  if (!data.lastSeen) {
    chatUserStatus.innerText = "";
    return;
  }

  const seenDate = new Date(data.lastSeen);
  const now = new Date();
  const diffDays = Math.floor((now - seenDate) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    chatUserStatus.innerText =
      "last seen today at " +
      seenDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    chatUserStatus.innerText =
      "last seen yesterday at " +
      seenDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else {
    chatUserStatus.innerText =
      "last seen " + seenDate.toLocaleDateString() + " " +
      seenDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
});

/* ================= TYPING ================= */
if (messageInput) {
  messageInput.addEventListener("input", () => {
    if (!currentChat) return;

    socket.emit("typing", { from: myPhone, to: currentChat });
    clearTimeout(typingTimer);

    typingTimer = setTimeout(() => {
      socket.emit("stopTyping", { from: myPhone, to: currentChat });
    }, 700);
  });
}


socket.on("typing", ({ from }) => {
  if (from === currentChat) chatUserStatus.innerText = "typing...";
});

socket.on("stopTyping", ({ from }) => {
  if (from === currentChat) socket.emit("getStatus", currentChat);
});

/* ================= SEND MESSAGE ================= */
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !currentChat) return;

// ✅ FINAL GROUP MESSAGE (SOCKET BASED ONLY)
if (currentChatMeta?.isGroup) {
  socket.emit("sendGroupMessage", {
    groupId: currentChat,
    from: myPhone,
    text
  });

  socket.emit("stopTyping", {
    from: myPhone,
    to: currentChat
  });

  messageInput.value = "";
  return;
}


  if (chatState[currentChat]?.blocked) {
    alert("Unblock the contact before sending messages.");
    return;
  }

  socket.emit("sendMessage", {
    from: myPhone,
    to: currentChat,
    text
  });

  socket.emit("stopTyping", { from: myPhone, to: currentChat });
  if (messageInput) messageInput.value = "";
}

// ================= RECEIVE FILE (GLOBAL – VERY IMPORTANT) =================
socket.on("receiveFile", file => {

  // ---------- PERSONAL CHAT ----------
  if (!file.isGroup) {
    if (file.to !== currentChat && file.from !== currentChat) return;

    renderFileMessage(file);
    updateChatPreviewForMessage(
      { text: "📎 File", from: file.from, to: file.to, createdAt: file.createdAt },
      { incoming: file.from !== myPhone }
    );
    return;
  }

  // ---------- GROUP CHAT ----------
  const groupId = file.to;

  if (!groupMessages[groupId]) groupMessages[groupId] = [];
  groupMessages[groupId].push(file);
  saveGroupMessages();

  if (currentChat === groupId) {
    renderFileMessage(file);
  }

  // update group preview
  const node = document.querySelector(`.chat[data-group-id="${groupId}"]`);
  if (node) {
    node.querySelector(".chat-status").innerText = "📎 File";
    node.querySelector(".time").innerText =
      new Date(file.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
    node.dataset.last = file.createdAt;
    reorderChatList();
  }
});


/* ================= RECEIVE MESSAGE ================= */
socket.on("receiveMessage", msg => {
if (msg.from === currentChat) {
    renderMessage(msg);
    updateChatPreviewForMessage(msg, { incoming: true });
  } else {
    // update preview + unread badge when message is for another chat
    updateChatPreviewForMessage(msg, { incoming: true });
  }
});

// ================= RECEIVE GROUP MESSAGE =================
socket.on("receiveGroupMessage", msg => {
  const groupId = msg.groupId;

  // save group message locally
  if (!groupMessages[groupId]) groupMessages[groupId] = [];
  groupMessages[groupId].push(msg);
  saveGroupMessages();

  // agar group open hai to turant show
  if (currentChat === groupId) {
    renderMessage(msg);
  }

  // 🔥 group chat preview update + reorder
  const node = document.querySelector(`.chat[data-group-id="${groupId}"]`);
  if (node) {
    const statusEl = node.querySelector(".chat-status");
    const timeEl = node.querySelector(".time");

    if (statusEl) statusEl.innerText = msg.text;
    if (timeEl) {
      timeEl.innerText = new Date(msg.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    node.dataset.last = new Date(msg.createdAt).getTime();
    reorderChatList();
  }
});


socket.on("messageSent", msg => {
  renderMessage(msg);
  updateChatPreviewForMessage(msg, { incoming: false });
});

socket.on("messageBlocked", data => {
  const reason =
    data.reason === "blocked-by-target"
      ? "Message blocked: contact has blocked you."
      : "Message blocked: you blocked this contact.";
  alert(reason);
});

/* ================= SEEN ================= */
socket.on("messageSeen", () => {
  document.querySelectorAll(".tick").forEach(t => {
    t.style.color = "#53bdeb";
  });
});

socket.on("refreshChatList", () => loadUsers());

/* ================= RENDER MESSAGE ================= */
function renderMessage(msg) {
  const div = document.createElement("div");
  const mine = msg.from === myPhone;

  div.className = "msg " + (mine ? "sent" : "received");
  div.dataset.id = msg._id;

  div.oncontextmenu = (e) => {
    e.preventDefault();
    showDeleteMenu(e.pageX, e.pageY, msg);
  };

  div.innerHTML = `
    <i style="color:#667781;font-size:13px">
      ${msg.deletedForEveryone ? "This message was deleted" : msg.text}
    </i>
    <small>
      ${new Date(msg.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      })}
      ${mine && !msg.deletedForEveryone ? `<span class="tick">✓✓</span>` : ""}
    </small>
  `;

  messagesBox.appendChild(div);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

// ensure chat tile updates + moves to top, and global unread dot on sidebar
function updateChatPreviewForMessage(msg, { incoming }) {
  const phone = incoming ? msg.from : msg.to;
  if (!phone || hiddenChats.includes(phone)) return;

  const node = document.querySelector(`.chat[data-phone="${phone}"]`);
  const time = new Date(msg.createdAt || Date.now()).getTime();

  if (node) {
    const statusEl = node.querySelector(".chat-status");
    const timeEl = node.querySelector(".time");
    if (statusEl && !msg.deletedForEveryone) {
      statusEl.innerText = msg.text;
    }
    if (timeEl) {
      timeEl.innerText = new Date(time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
    }
    node.dataset.last = time;

    if (incoming && phone !== currentChat) {
      // add / bump unread badge
      let badge = node.querySelector(".unread-badge");
      if (!badge) {
        node
          .querySelector(".chat-meta")
          ?.insertAdjacentHTML("beforeend", `<span class="unread-badge">1</span>`);
      } else {
        const current = parseInt(badge.innerText || "0", 10) || 0;
        badge.innerText = String(current + 1);
      }
    }
    reorderChatList();
    refreshGlobalUnreadIndicator();
    return;
  }

  // fallback: if chat tile not present, just reload list
  loadUsers();
}

/* ================= PROFILE ================= */
const settingsBtn = document.querySelector(".settings-btn");
if (settingsBtn) settingsBtn.addEventListener("click", openProfile);

function openProfile() {
  fetch(`http://localhost:3000/profile/${myPhone}`)
    .then(res => res.json())
    .then(user => {
      let photo = "";
      if (user.photo === null) photo = "";
      else if (user.photo) photo = user.photo;
      else photo = defaultAvatar(myPhone);

      const about = user.about || "Hey there! I am using WhatsApp.";
      const name = user.name || myPhone;

      const modal = `
        <div id="profileModal" style="
          position:fixed;inset:0;background:rgba(0,0,0,.4);
          display:flex;align-items:center;justify-content:center;
          z-index:9999">
          <div style="background:#fff;width:420px;padding:24px;border-radius:12px">
            <h3 style="margin-bottom:12px">Profile</h3>
            <div style="text-align:center;margin-bottom:16px">
              ${
                photo
                  ? `<img src="${photo}" style="width:120px;height:120px;border-radius:50%">`
                  : `<div class="blank-avatar large">${firstLetter(name, myPhone)}</div>`
              }
              <div style="margin-top:10px;color:#008069;cursor:pointer">
                <label style="cursor:pointer">
                  <span class="material-icons" style="vertical-align:middle">edit</span> Change photo
                  <input type="file" id="profileFile" style="display:none">
                </label>
              </div>
            </div>

            <div style="margin-bottom:12px">
              <label style="font-size:12px;color:#667781">Name</label>
              <div style="display:flex;align-items:center;gap:8px">
                <input id="profileName" value="${name}" style="flex:1;padding:10px;border-radius:8px;border:1px solid #d0d7dc">
                <span class="material-icons" style="color:#667781">edit</span>
              </div>
            </div>

            <div style="margin-bottom:12px">
              <label style="font-size:12px;color:#667781">About</label>
              <div style="display:flex;align-items:center;gap:8px">
                <input id="profileAbout" value="${about}" style="flex:1;padding:10px;border-radius:8px;border:1px solid #d0d7dc">
                <span class="material-icons" style="color:#667781">edit</span>
              </div>
            </div>

            <div style="margin-bottom:12px">
              <label style="font-size:12px;color:#667781">Phone</label>
              <div style="display:flex;align-items:center;gap:8px">
                <span class="material-icons" style="color:#667781">call</span>
                <b>${myPhone}</b>
                <span class="material-icons" style="color:#667781">content_copy</span>
              </div>
            </div>

            <div style="text-align:right;margin-top:12px;display:flex;justify-content:flex-end;gap:10px">
              <button onclick="removeProfilePhoto()" style="color:red;border:none;background:transparent">Remove photo</button>
              <button onclick="closeProfile()" style="border:1px solid #d0d7dc;padding:8px 12px;border-radius:8px">Cancel</button>
              <button onclick="saveProfile()" style="background:#008069;color:#fff;border:none;padding:8px 16px;border-radius:8px">
                Save
              </button>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML("beforeend", modal);
    });
}

function closeProfile() {
  document.getElementById("profileModal")?.remove();
}

function saveProfile() {
  const file = document.getElementById("profileFile").files[0];
  const about = document.getElementById("profileAbout").value;
  const name = document.getElementById("profileName").value;

  const form = new FormData();
  form.append("phone", myPhone);
  if (file) form.append("photo", file);
  form.append("about", about);
  form.append("name", name);

  fetch("http://localhost:3000/profile/upload", {
    method: "POST",
    body: form
  }).then(() => {
    closeProfile();
    loadUsers();
    refreshSettingsCard();
    // Update sidebar profile
    fetch(`http://localhost:3000/profile/${myPhone}`)
      .then(res => res.json())
      .then(user => {
        const sidebarImg = document.querySelector(".wa-profile img");
        if (sidebarImg) {
          sidebarImg.src = user.photo === null ? defaultAvatar(myPhone) : user.photo || defaultAvatar(myPhone);
        }
      });
  });
}

function removeProfilePhoto() {
  fetch("http://localhost:3000/profile/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: myPhone })
  }).then(() => {
    closeProfile();
    loadUsers();
  });
}

/* ================= LIVE PROFILE UPDATE ================= */
socket.on("profileUpdated", data => {
  document.querySelectorAll(".chat").forEach(chat => {
    if (chat.dataset.phone === data.phone) {
      const avatar = chat.querySelector(".chat-avatar");

      avatar.innerHTML =
        data.photo === null
          ? `<div class="blank-avatar">${firstLetter(data.name || data.phone, data.phone)}</div>`
          : data.photo
          ? `<img src="${data.photo}">`
          : `<img src="${defaultAvatar(data.phone)}">`;

      const nameEl = chat.querySelector("b");
      if (nameEl) nameEl.innerText = data.name || data.phone;
    }
  });

  if (currentChat === data.phone) {
    chatUserAvatar.src =
      data.photo === null
        ? defaultAvatar(data.phone)
        : data.photo || defaultAvatar(data.phone);

    chatUserName.innerText = data.name || data.phone;
  }

  if (data.phone === myPhone) {
    const sidebarImg = document.querySelector(".wa-profile img");
    if (sidebarImg)
      sidebarImg.src =
        data.photo === null
          ? defaultAvatar(myPhone)
          : data.photo || defaultAvatar(myPhone);
    
    // Also update settings card
    refreshSettingsCard();
    
    // Update chat header if viewing own profile
    if (currentChat === myPhone) {
      chatUserAvatar.src = data.photo === null ? defaultAvatar(myPhone) : data.photo || defaultAvatar(myPhone);
      chatUserName.innerText = data.name || myPhone;
    }
  }
});

/* ================= SIDEBAR BUTTONS ================= */
// Sidebar buttons are initialized in initApp() function

document.getElementById("openProfileFromSettings")?.addEventListener("click", () => {
  openProfile();
});

// small green dot on chat icon when any chat is unread
function refreshGlobalUnreadIndicator() {
  const hasUnread = !!document.querySelector(".chat .unread-badge");
  if (hasUnread) {
    window.btnChat?.classList.add("dot");
  } else {
    window.btnChat?.classList.remove("dot");
  }
}

/* ================= FILTER + SEARCH ================= */

const filterAll = document.getElementById("filter-all");
const filterUnread = document.getElementById("filter-unread");
const filterFav = document.getElementById("filter-fav");
const filterGroups = document.getElementById("filter-groups");
const searchInput = document.getElementById("searchInput");

function setFilterActive(el) {
  document.querySelectorAll(".filters span")
    .forEach(s => s.classList.remove("active"));
  el.classList.add("active");
}

/* 🔍 SEARCH */
if (searchInput) {
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.toLowerCase();

    document.querySelectorAll(".chat").forEach(chat => {
      const name = chat.innerText.toLowerCase();
      chat.style.display = name.includes(q) ? "flex" : "none";
    });
  });
}


/* 📂 ALL */
filterAll?.addEventListener("click", () => {
  setFilterActive(filterAll);
  document.querySelectorAll(".chat")
    .forEach(c => (c.style.display = "flex"));
});


/* 🔔 UNREAD */
filterUnread?.addEventListener("click", () => {
  setFilterActive(filterUnread);

  document.querySelectorAll(".chat").forEach(chat => {
    chat.style.display =
      chat.querySelector(".unread-badge") ? "flex" : "none";
  });
});

/* ⭐ FAVOURITES */
filterFav?.addEventListener("click", () => {
  setFilterActive(filterFav);

  document.querySelectorAll(".chat").forEach(chat => {
    const phone = chat.dataset.phone;
    const state = chatState[phone] || {};
    const prefs = chatPrefs[phone] || {};
    const isFav = state.favourite || prefs.favourite;
    chat.style.display = isFav ? "flex" : "none";
  });
});

/* 👥 GROUPS */
filterGroups?.addEventListener("click", () => {
  setFilterActive(filterGroups);

  document.querySelectorAll(".chat").forEach(chat => {
    const isGroup = chat.dataset.groupId ? true : false;
    chat.style.display = isGroup ? "flex" : "none";
  });
});

// Header menu + new chat
const chatMenuBtn = document.getElementById("chatMenuBtn");
const chatMenu = document.getElementById("chatMenu");
const newChatBtn = document.getElementById("newChatBtn");
const newChatOverlay = document.getElementById("newChatOverlay");
const closeNewChat = document.getElementById("closeNewChat");
const newChatShortcuts = document.getElementById("newChatShortcuts");

function toggleDropdown(drop) {
  if (!drop) return;
  drop.classList.toggle("hidden");
  document.addEventListener(
    "click",
    e => {
      if (!drop.contains(e.target) && e.target !== chatMenuBtn) {
        drop.classList.add("hidden");
      }
    },
    { once: true }
  );
}

chatMenuBtn?.addEventListener("click", e => {
  e.stopPropagation();
  toggleDropdown(chatMenu);
});

chatMenu?.addEventListener("click", e => {
  const action = e.target.closest(".item")?.dataset.action;
  if (!action) return;
  switch (action) {
    case "new-group":
      activateSidebar(btnCommunities);
      showScreen("communities");
      document.getElementById("groupName")?.focus();
      break;
    case "new-community":
      activateSidebar(btnCommunities);
      showScreen("communities");
      document.getElementById("groupName")?.focus();
      break;
    case "starred":
      const starredOverlay = document.createElement("div");
      starredOverlay.id = "starredOverlay";
      starredOverlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:2000";
      starredOverlay.innerHTML = `
        <div style="background:#fff;width:500px;max-width:90%;max-height:80vh;border-radius:12px;padding:20px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h3 style="margin:0">Starred messages</h3>
            <span class="material-icons" id="closeStarred" style="cursor:pointer">close</span>
          </div>
          <div id="starredMessages" style="max-height:400px;overflow-y:auto">
            <p>No starred messages yet.</p>
          </div>
        </div>
      `;
      document.body.appendChild(starredOverlay);
      document.getElementById("closeStarred").onclick = () => starredOverlay.remove();
      starredOverlay.onclick = e => {
        if (e.target === starredOverlay) starredOverlay.remove();
      };
      break;
    case "select-chats":
      alert("Select chats: Feature not fully implemented. Click on chats to select them.");
      // TODO: Implement selection mode
      break;
    case "mark-all-read":
      document.querySelectorAll(".unread-badge").forEach(b => b.remove());
      refreshGlobalUnreadIndicator();
      alert("All chats marked as read");
      break;
    case "app-lock":
      const pin = prompt("Set app lock PIN");
      if (pin) {
        localStorage.setItem("appLockPin", pin);
        alert("App lock set");
      }
      break;
    case "logout":
      doLogout();
      break;
    default:
      alert(`${action} selected`);
  }
  chatMenu.classList.add("hidden");
});

newChatBtn?.addEventListener("click", () => {
  newChatOverlay?.classList.remove("hidden");
});
closeNewChat?.addEventListener("click", () => newChatOverlay?.classList.add("hidden"));
newChatOverlay?.addEventListener("click", e => {
  if (e.target === newChatOverlay) newChatOverlay.classList.add("hidden");
});
newChatShortcuts?.addEventListener("click", e => {
  const action = e.target.closest(".item")?.dataset.action;
  if (!action) return;
  if (action === "new-group") {
    const modal = document.getElementById("groupCreateModal");
    modal.querySelector("div[style*='font-weight:700']").textContent = "Create Group";
    modal.classList.remove("hidden");
    newChatOverlay.classList.add("hidden");
    // Add listeners
    modal.querySelector("#modalCancel")?.addEventListener("click", () => modal.classList.add("hidden"));
    modal.querySelector("#modalCreateGroup")?.addEventListener("click", () => {
      const name = document.getElementById("modalGroupName").value.trim();
      const membersRaw = document.getElementById("modalGroupMembers").value.trim();
      if (!name) return alert("Group name required");
      const members = membersRaw ? membersRaw.split(",").map(m => m.trim()).filter(Boolean) : [];
      
      modal.classList.add("hidden");
    });
    modal.querySelector("#modalPickMembers")?.addEventListener("click", () => {
      modal.classList.add("blurred");
      openMemberPicker({
        selected: [],
        title: "Select members",
        onSave: phones => {
          document.getElementById("modalGroupMembers").value = phones.join(", ");
          modal.classList.remove("blurred");
        }
      });
    });
  } else if (action === "new-community") {
    const modal = document.getElementById("groupCreateModal");
    modal.querySelector("div[style*='font-weight:700']").textContent = "Create Community";
    modal.classList.remove("hidden");
    newChatOverlay.classList.add("hidden");
    // Add listeners
    modal.querySelector("#modalCancel")?.addEventListener("click", () => modal.classList.add("hidden"));
    modal.querySelector("#modalCreateGroup")?.addEventListener("click", () => {
      const name = document.getElementById("modalGroupName").value.trim();
      const membersRaw = document.getElementById("modalGroupMembers").value.trim();
      if (!name) return alert("Community name required");
      const members = membersRaw ? membersRaw.split(",").map(m => m.trim()).filter(Boolean) : [];
      groups.unshift({ id: uid(), name, members, createdAt: Date.now(), type: "community" });
      document.getElementById("modalGroupName").value = "";
      document.getElementById("modalGroupMembers").value = "";
      saveGroups();
      modal.classList.add("hidden");
    });
    modal.querySelector("#modalPickMembers")?.addEventListener("click", () => {
      modal.classList.add("blurred");
      openMemberPicker({
        selected: [],
        title: "Select members",
        onSave: phones => {
          document.getElementById("modalGroupMembers").value = phones.join(", ");
          modal.classList.remove("blurred");
        }
      });
    });
  } else if (action === "new-contact") {
    const phone = prompt("Enter contact number");
    const name = prompt("Enter contact name (optional)") || "";
    if (phone) {
      fetch("http://localhost:3000/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name })
      }).then(() => {
        loadUsers();
        // Refresh cached users to include new contact
        fetch(`http://localhost:3000/contacts/${myPhone}`)
          .then(res => res.json())
          .then(contacts => {
            // Merge with existing cachedUsers, prioritizing contacts
            const contactMap = new Map(contacts.map(c => [c.phone, c]));
            cachedUsers.forEach(u => {
              if (!contactMap.has(u.phone)) {
                contactMap.set(u.phone, u);
              }
            });
            cachedUsers = Array.from(contactMap.values());
          });
      });
    }
  } else {
    alert(`${action} coming soon`);
  }
});

/* ================= STATUS (BACKEND, 24H) ================= */
const statusList = document.getElementById("statusList");
const statusText = document.getElementById("statusText");
const statusMediaInput = document.getElementById("statusMediaInput");
const statusAudioInput = document.getElementById("statusAudioInput");
const statusMediaLabel = document.getElementById("statusMediaLabel");
let statuses = [];
const statusLocalKey = `wa-status-local-${myPhone}`;
let localStatuses = loadJSON(statusLocalKey, []);
let statusDraft = { type: "text", mediaUrl: "", mediaType: null };

function renderStatuses() {
  if (!statusList) return;
  statusList.innerHTML = "";
  const combined = [...localStatuses, ...statuses].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  if (!combined.length) {
    statusList.innerHTML = `<div class="empty">No status yet. Add one to match WhatsApp style.</div>`;
    return;
  }

  combined.forEach(s => {
    const card = document.createElement("div");
    card.className = "status-card";
    const isAudio = s.mediaType === "audio";
    const isVideo = s.mediaType === "video";
    const isImage = s.mediaType === "image" || s.image;
    const lastView =
      s.phone === myPhone &&
      Array.isArray(s.views) &&
      s.views.length
        ? new Date(s.views[0].viewedAt || s.views[0]).toLocaleString()
        : "";
    const thumb = isAudio
      ? `<span class="material-icons" style="color:#0b5394">graphic_eq</span>`
      : isVideo
      ? `<span class="material-icons" style="color:#c47d00">movie</span>`
      : isImage
      ? `<img src="${s.mediaUrl || s.image}">`
      : `<span style="font-size:20px">✦</span>`;
    const viewCount = Array.isArray(s.views) ? s.views.length : 0;
    const viewed = Array.isArray(s.views)
      ? s.views.some(v => (v.phone || v) === myPhone)
      : false;
    card.innerHTML = `
      <div class="status-thumb" style="border:${viewed ? "2px solid #cfd4d8" : "2px solid #25d366"}">${thumb}</div>
      <div class="status-meta">
        <b>${s.phone === myPhone ? "My status" : s.phone}</b><br>
        <small>${new Date(s.createdAt).toLocaleString()}</small>
        <small>${viewCount} views${lastView ? ` • last at ${lastView}` : ""}</small>
      </div>
      <div style="display:flex;gap:8px;margin-left:auto;flex-wrap:wrap">
        <button class="btn secondary view-btn" data-id="${s._id || s.localId}">
          ${s.phone === myPhone ? "View viewers" : viewed ? "Viewed" : "View"}
        </button>
        ${
          s.phone === myPhone
            ? `<button class="btn danger delete-btn" data-id="${s._id || s.localId}">Delete</button>`
            : ""
        }
      </div>
    `;
    card.querySelector(".view-btn").onclick = () => openStatusModal(s);
    const delBtn = card.querySelector(".delete-btn");
    if (delBtn) delBtn.onclick = () => deleteStatus(s);
    statusList.appendChild(card);
  });
}

async function fetchStatusViews(statusId) {
  const res = await fetch(`http://localhost:3000/status/${statusId}/views`);
  return res.json();
}

async function markStatusViewed(status) {
  if (!status?._id || status.phone === myPhone) return;
  await fetch("http://localhost:3000/status/view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: myPhone, statusId: status._id })
  });
}

async function deleteStatus(status) {
  if (status.localId) {
    localStatuses = localStatuses.filter(ls => ls.localId !== status.localId);
    localStorage.setItem(statusLocalKey, JSON.stringify(localStatuses));
    renderStatuses();
    return;
  }
  if (!status._id) return;

  await fetch("http://localhost:3000/status/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: myPhone, statusId: status._id })
  });
  statuses = statuses.filter(s => s._id !== status._id);
  renderStatuses();
}

async function openStatusModal(status) {
  if (!status) return;
  if (status.phone !== myPhone) {
    await markStatusViewed(status);
    await loadStatuses();
  }

  let views = [];
  if (status._id) {
    try {
      views = await fetchStatusViews(status._id);
    } catch (e) {
      views = [];
    }
  }

  const viewers = (views || []).map(
    v =>
      `<li style="padding:4px 0;border-bottom:1px solid #eee">
        <b>${v.phone}</b>
        <small style="color:#667781;display:block">${new Date(v.viewedAt || Date.now()).toLocaleString()}</small>
      </li>`
  ).join("") || "<li>No views yet</li>";

  const media = status.mediaUrl || status.image;
  const modal = `
    <div id="statusModal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999">
      <div style="background:#fff;width:520px;max-height:80vh;overflow:auto;border-radius:12px;padding:16px;position:relative">
        <span class="material-icons" style="position:absolute;top:8px;right:8px;cursor:pointer" onclick="closeStatusModal()">close</span>
        <h3 style="margin-bottom:8px">${status.phone === myPhone ? "My status" : status.phone}</h3>
        <small style="color:#667781">${new Date(status.createdAt).toLocaleString()}</small>
        <div style="margin:12px 0">
          ${status.text || ""}
          ${media ? `<div style="margin-top:10px"><img src="${media}" style="max-width:100%;border-radius:10px"></div>` : ""}
        </div>
        <div>
          <b>Views (${views?.length || 0})</b>
          <ul style="list-style:none;padding:0;margin-top:6px">${viewers}</ul>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", modal);
}

function closeStatusModal() {
  document.getElementById("statusModal")?.remove();
}

async function loadStatuses() {
  const res = await fetch(`http://localhost:3000/status/feed/${myPhone}`);
  statuses = await res.json();
  renderStatuses();
}

document.getElementById("addStatusBtn")?.addEventListener("click", async () => {
  const text = statusText.value.trim();
  const hasMedia = statusDraft.mediaUrl;

  if (!text && !hasMedia) return alert("Add text or media for status");

  // Save locally to guarantee it shows even if backend doesn't support the media type
  localStatuses.unshift({
    localId: uid(),
    phone: myPhone,
    text,
    mediaUrl: statusDraft.mediaUrl,
    mediaType: statusDraft.mediaType,
    createdAt: Date.now(),
    views: []
  });
  localStorage.setItem(statusLocalKey, JSON.stringify(localStatuses));

  // Best-effort push to backend for image/text
  if (!statusDraft.mediaType || statusDraft.mediaType === "image") {
    await fetch("http://localhost:3000/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: myPhone,
        text,
        image: statusDraft.mediaUrl || ""
      })
    });
  }

  statusText.value = "";
  statusDraft = { type: "text", mediaUrl: "", mediaType: null };
  statusMediaLabel.innerText = "";
  renderStatuses();
  loadStatuses();
});

document.getElementById("clearStatusesBtn")?.addEventListener("click", async () => {
  statuses = [];
  localStatuses = [];
  localStorage.setItem(statusLocalKey, JSON.stringify(localStatuses));
  renderStatuses();
});

socket.on("statusNew", () => loadStatuses());
socket.on("statusViewed", () => loadStatuses());
socket.on("statusDeleted", () => loadStatuses());

loadStatuses();

// Status controls (media triggers)
document.getElementById("statusAddBtn")?.addEventListener("click", () => {
  statusMediaLabel.innerText = "Select photo/video or just add text";
  statusMediaInput?.click();
});

const statusMoreBtn = document.getElementById("statusMoreBtn");
const statusMoreMenu = document.getElementById("statusMoreMenu");

statusMoreBtn?.addEventListener("click", e => {
  e.stopPropagation();
  statusMoreMenu?.classList.toggle("hidden");
  document.addEventListener(
    "click",
    ev => {
      if (!statusMoreMenu.contains(ev.target) && ev.target !== statusMoreBtn) {
        statusMoreMenu.classList.add("hidden");
      }
    },
    { once: true }
  );
});

statusMoreMenu?.addEventListener("click", e => {
  const action = e.target.closest(".item")?.dataset.action;
  if (!action) return;
  if (action === "status-clear") {
    statuses = [];
    localStatuses = [];
    localStorage.setItem(statusLocalKey, JSON.stringify(localStatuses));
    renderStatuses();
  }
  if (action === "status-refresh") loadStatuses();
  statusMoreMenu.classList.add("hidden");
});

document.getElementById("statusPhotoTrigger")?.addEventListener("click", () => {
  statusMediaInput?.click();
});

document.getElementById("statusAudioTrigger")?.addEventListener("click", () => {
  statusAudioInput?.click();
});

document.getElementById("statusTextTrigger")?.addEventListener("click", () => {
  statusDraft = { type: "text", mediaUrl: "", mediaType: null };
  statusMediaLabel.innerText = "Text only status selected";
});

statusMediaInput?.addEventListener("change", e => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    statusDraft = {
      mediaUrl: reader.result,
      mediaType: file.type.startsWith("video") ? "video" : "image"
    };
    statusMediaLabel.innerText = `${file.name} attached (${statusDraft.mediaType})`;
  };
  reader.readAsDataURL(file);
});

statusAudioInput?.addEventListener("change", e => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    statusDraft = { mediaUrl: reader.result, mediaType: "audio" };
    statusMediaLabel.innerText = `${file.name} attached (audio)`;
  };
  reader.readAsDataURL(file);
});

/* ================= CALLS (SIMULATED) ================= */
const callLogEl = document.getElementById("callLog");
const callBanner = document.getElementById("callBanner");
const callBannerTitle = document.getElementById("callBannerTitle");
const callBannerMeta = document.getElementById("callBannerMeta");
const quickVoice = document.getElementById("quickVoice");
const quickVideo = document.getElementById("quickVideo");
let activeCall = null;

async function loadCalls() {
  const res = await fetch(`http://localhost:3000/calls/${myPhone}`);
  const calls = await res.json();
  renderCalls(calls);
}

function renderCalls(calls = []) {
  if (!callLogEl) return;
  callLogEl.innerHTML = "";
  if (!calls.length) {
    callLogEl.innerHTML = `<div class="empty">No calls yet. Start a voice/video call.</div>`;
    return;
  }

  calls.forEach(log => {
    const div = document.createElement("div");
    div.className = "call-card";
    const direction = log.from === myPhone ? "Outgoing" : "Incoming";
    const status = log.status || "ended";
    div.innerHTML = `
      <div class="call-meta">
        <b>${log.from === myPhone ? log.to : log.from}</b><br>
        <small>${direction} • ${status} • ${new Date(log.createdAt).toLocaleString()}</small>
      </div>
      <span class="badge ${log.type === "voice" ? "voice" : "video"}">${log.type} call</span>
    `;
    callLogEl.appendChild(div);
  });
}

function startCall(type) {
  if (!currentChat) return alert("Select a chat first");
  
  // Handle group calls
  if (currentChatMeta?.isGroup) {
    const groupId = currentChat;
    const group = groups.find(g => (g.id || g.name) === groupId);
    if (!group || !group.members || group.members.length === 0) {
      return alert("No members in group to call");
    }
    
    // Send call to all group members
    group.members.forEach(memberPhone => {
      if (memberPhone !== myPhone) {
        socket.emit("call:start", { from: myPhone, to: memberPhone, type, groupId });
      }
    });
    
    activeCall = { to: groupId, type, start: Date.now(), isGroup: true };
    callBannerTitle.innerText = `${type === "voice" ? "Voice" : "Video"} call`;
    callBannerMeta.innerText = `Calling ${group.name} (${group.members.length} members)...`;
    callBanner.style.display = "flex";
    return;
  }
  
  // Regular call
  activeCall = { to: currentChat, type, start: Date.now() };
  callBannerTitle.innerText = `${type === "voice" ? "Voice" : "Video"} call`;
  callBannerMeta.innerText = `Calling ${currentChat}...`;
  callBanner.style.display = "flex";
  socket.emit("call:start", { from: myPhone, to: currentChat, type });
}

function endCall(status = "ended") {
  if (!activeCall) return;
  const duration = Math.floor((Date.now() - activeCall.start) / 1000);
  
  if (activeCall.isGroup) {
    // For group calls, end call for all members
    const groupId = activeCall.to;
    const group = groups.find(g => (g.id || g.name) === groupId);
    if (group && group.members) {
      group.members.forEach(memberPhone => {
        if (memberPhone !== myPhone) {
          socket.emit("call:end", { from: myPhone, to: memberPhone });
          fetch("http://localhost:3000/calls/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              from: myPhone,
              to: memberPhone,
              type: activeCall.type,
              status,
              duration
            })
          });
        }
      });
    }
  } else {
    fetch("http://localhost:3000/calls/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: myPhone,
        to: activeCall.to,
        type: activeCall.type,
        status,
        duration
      })
    }).then(() => loadCalls());
    socket.emit("call:end", { from: myPhone, to: activeCall.to });
  }
  
  activeCall = null;
  callBanner.style.display = "none";
}

document.getElementById("startVoiceCall")?.addEventListener("click", () => startCall("voice"));
document.getElementById("startVideoCall")?.addEventListener("click", () => startCall("video"));
quickVoice?.addEventListener("click", () => startCall("voice"));
quickVideo?.addEventListener("click", () => startCall("video"));
document.getElementById("endCallBtn")?.addEventListener("click", () => endCall());

socket.on("call:incoming", data => {
  if (data.to !== myPhone) return;
  activeCall = { to: data.from, type: data.type, start: Date.now() };
  callBannerTitle.innerText = `${data.type === "voice" ? "Voice" : "Video"} call`;
  callBannerMeta.innerText = `Incoming from ${data.from}`;
  callBanner.style.display = "flex";
  const accept = confirm(`Incoming ${data.type} call from ${data.from}. Accept?`);
  if (accept) {
    socket.emit("call:accept", { from: myPhone, to: data.from });
    callBannerMeta.innerText = `Connected with ${data.from}`;
  } else {
    socket.emit("call:reject", { from: myPhone, to: data.from });
    endCall("rejected");
  }
});

socket.on("call:accepted", data => {
  if (data.to !== myPhone) return;
  callBannerMeta.innerText = `Connected with ${data.from}`;
});

socket.on("call:rejected", data => {
  if (data.to !== myPhone) return;
  callBannerMeta.innerText = `Rejected by ${data.from}`;
  endCall("rejected");
});

socket.on("call:ended", data => {
  if (data.to !== myPhone) return;
  endCall("ended");
});




// Function to scroll to a specific message
window.scrollToMessage = function(messageId) {
  const msgEl = document.querySelector(`[data-id="${messageId}"]`);
  if (msgEl) {
    msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    msgEl.style.background = '#fff3cd';
    setTimeout(() => {
      msgEl.style.background = '';
    }, 2000);
  }
  document.getElementById('chatSearchOverlay')?.remove();
  chatSearchActive = false;
};

// Chat action menu (three dots inside chat header)
const chatActionMenuBtn = document.getElementById("chatActionMenuBtn");
const chatActionMenu = document.getElementById("chatActionMenu");

function clearCurrentChat() {
  if (!currentChat) return;
  
  // Clear messages from DOM
  messagesBox.innerHTML = "";
  
  // Clear messages from backend (mark as deleted for me)
  if (currentChatMeta?.isGroup) {
    // For groups, clear local storage
    const groupId = currentChat;
    if (groupMessages[groupId]) {
      groupMessages[groupId] = [];
      saveGroupMessages();
    }
  } else {
    // For regular chats, mark all messages as deleted for me
    fetch(`http://localhost:3000/messages/${myPhone}/${currentChat}`)
      .then(res => res.json())
      .then(msgs => {
        msgs.forEach(msg => {
          socket.emit("deleteForMe", {
            messageId: msg._id,
            phone: myPhone
          });
        });
      });
  }
  
  // Don't remove chat from list - just clear messages
}

function closeChat() {
  currentChat = null;
  chatUserName.innerText = "Select a chat";
  chatUserStatus.innerText = "";
  messagesBox.innerHTML = "";
}

function updateChatActionMenu(state = {}, isGroup = false) {
  if (!chatActionMenu) return;
  const prefs = chatPrefs[currentChat] || {};
  const favourite = state.favourite || prefs.favourite;
  const blocked = state.blocked;
  const items = isGroup
    ? [
        ["group-info", "Group info"],
        ["select-messages", "Select messages"],
        ["mute", "Mute notifications"],
        ["disappearing", "Disappearing messages"],
        [favourite ? "unfavourite" : "favourite", favourite ? "Remove from favourites" : "Add to favourites"],
        ["close-chat", "Close chat"],
        ["clear-chat", "Clear chat"],
        ["exit-group", "Exit group"]
      ]
    : [
        ["contact-info", "Contact info"],
        ["select-messages", "Select messages"],
        ["mute", "Mute notifications"],
        ["disappearing", "Disappearing messages"],
        [favourite ? "unfavourite" : "favourite", favourite ? "Remove from favourites" : "Add to favourites"],
        ["close-chat", "Close chat"],
        ["report", "Report"],
        [blocked ? "unblock" : "block", blocked ? "Unblock" : "Block"],
        ["clear-chat", "Clear chat"],
        ["delete-chat", "Delete chat"]
      ];

  chatActionMenu.innerHTML = items
    .map(
      ([key, label]) =>
        `<div class="item" data-action="${key}"><span class="material-icons">chevron_right</span>${label}</div>`
    )
    .join("");
}

chatActionMenuBtn?.addEventListener("click", e => {
  e.stopPropagation();
  toggleDropdown(chatActionMenu);
});

chatActionMenu?.addEventListener("click", e => {
  const action = e.target.closest(".item")?.dataset.action;
  if (!action) return;
  switch (action) {
    case "contact-info":
      alert("Contact info");
      break;
    case "group-info":
      if (currentChatMeta?.isGroup) {
        openGroupInfo(currentChatMeta);
      } else {
        alert("Group info");
      }
      break;
    case "clear-chat":
      clearCurrentChat();
      break;
    case "close-chat":
      closeChat();
      break;
    case "mute":
      alert("Chat muted (simulated)");
      break;
    case "disappearing":
      alert("Disappearing messages toggled");
      break;
    case "favourite":
      toggleFavourite(currentChat, true);
      break;
    case "unfavourite":
      toggleFavourite(currentChat, false);
      break;
    case "block":
      toggleBlock(currentChat, true);
      break;
    case "unblock":
      toggleBlock(currentChat, false);
      break;
    case "report":
      alert("Reported");
      break;
    case "delete-chat":
      if (currentChat) {
        const node = document.querySelector(`[data-phone="${currentChat}"]`);
        if (node) node.remove();
        if (!hiddenChats.includes(currentChat)) {
          hiddenChats.push(currentChat);
          localStorage.setItem(hiddenChatsKey, JSON.stringify(hiddenChats));
        }
        if (currentChat === currentChatMeta?.phone) {
          closeChat();
        }
        reorderChatList();
      }
      break;
    case "exit-group":
      alert("Exited group");
      break;
    default:
      alert(`${action} updated`);
  }
  chatActionMenu.classList.add("hidden");
});

loadCalls();

/* ================= GROUPS (LOCAL) ================= */
const groupKey = `wa-groups-${myPhone}`;
let groups = loadJSON(groupKey, []);
const groupList = document.getElementById("groupList");

function saveGroups() {
  localStorage.setItem(groupKey, JSON.stringify(groups));
  renderGroups();
  renderGroupChatsIntoChatList();
}

function openMemberPicker({ selected = [], onSave, title = "Select members" }) {
  document.getElementById("memberPicker")?.remove();
  
  // Use cached users
  const contacts = cachedUsers.filter(u => {
    return u.phone && 
           u.phone !== myPhone && 
           !hiddenChats.includes(u.phone) &&
           !(chatState[u.phone]?.blocked) &&
           !(chatState[u.phone]?.blockedBy);
  });
  
  renderMemberPicker(contacts, selected, onSave, title);
}

function renderMemberPicker(contacts, selected, onSave, title) {
  
  const options = contacts.map(u => {
    const isChecked = selected.includes(u.phone);
    const initial = firstLetter(u.name, u.phone);
    return `
      <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #eee">
        <input type="checkbox" data-phone="${u.phone}" ${isChecked ? "checked" : ""}>
        <div class="chat-avatar" style="width:32px;height:32px;">
          ${u.photo ? `<img src="${u.photo}">` : `<div class="blank-avatar" style="width:32px;height:32px;font-size:12px">${initial}</div>`}
        </div>
        <span>${u.name || u.phone}</span>
      </label>
    `;
  }).join("") || `<div class="empty">No contacts yet. Add some chats first.</div>`;

  const modal = `
    <div id="memberPicker" style="position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:2000">
      <div style="background:#fff;width:420px;max-height:70vh;overflow:auto;border-radius:12px;padding:16px;position:relative">
        <div style="font-weight:700;margin-bottom:12px">${title}</div>
        <div style="display:flex;flex-direction:column;gap:0">${options}</div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px">
          <button class="btn secondary" id="memberPickerCancel" type="button">Cancel</button>
          <button class="btn" id="memberPickerSave" type="button">Save</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", modal);

  const modalEl = document.getElementById("memberPicker");
  modalEl?.querySelector("#memberPickerCancel")?.addEventListener("click", () => modalEl.remove());
  modalEl?.querySelector("#memberPickerSave")?.addEventListener("click", () => {
    const selectedPhones = Array.from(
      modalEl.querySelectorAll('input[type="checkbox"]:checked')
    ).map(i => i.dataset.phone);
    onSave?.(selectedPhones);
    modalEl.remove();
  });

  modalEl?.addEventListener("click", e => {
    if (e.target === modalEl) {
      modalEl.remove();
    }
  });
}

function renderGroups() {
  if (!groupList) return;
  groupList.innerHTML = "";
  if (!groups.length) {
    groupList.innerHTML = `<div class="empty">No groups yet. Create one to start.</div>`;
    return;
  }

  groups.forEach((g, idx) => {
    const card = document.createElement("div");
    card.className = "group-card";
    const initials = g.name.slice(0, 2).toUpperCase();
    card.innerHTML = `
      <div class="group-avatar">${initials}</div>
      <div class="group-meta">
        <b>${g.name}</b><br>
        <small>${g.members.length} members • ${new Date(g.createdAt).toLocaleDateString()}</small>
      </div>
      <div style="display:flex;gap:8px;margin-left:auto;flex-wrap:wrap">
        <button class="btn secondary" data-action="manage" data-idx="${idx}">Manage</button>
        <button class="btn danger" data-action="delete" data-idx="${idx}">Delete</button>
      </div>
    `;
    card.querySelector('[data-action="delete"]').onclick = () => {
      groups.splice(idx, 1);
      saveGroups();
    };
    card.querySelector('[data-action="manage"]').onclick = () => {
      openMemberPicker({
        selected: g.members || [],
        title: `Members for ${g.name}`,
        onSave: phones => {
          groups[idx].members = Array.from(new Set(phones));
          saveGroups();
        }
      });
    };
    groupList.appendChild(card);
  });
}

// inject groups into main chat list (local-only group chats)
function renderGroupChatsIntoChatList() {
  if (!chatList) return;

  // remove previous group nodes from list
  document
    .querySelectorAll(".chat[data-group-id]")
    .forEach(e => e.remove());

  groups.forEach(g => {
    const groupId = g.id || g.name;
    const div = document.createElement("div");
    div.className = "chat";
    div.dataset.groupId = groupId;
    div.dataset.last = "0";
    const initials = (g.name || groupId).slice(0, 2).toUpperCase();
    const avatarColor = getAvatarColor(initials.charAt(0));
    const lastMessages = groupMessages[groupId] || [];
    const last = lastMessages[lastMessages.length - 1];
    const lastText = last ? last.text : "";
    const lastTime = last
      ? new Date(last.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        })
      : "";

    div.innerHTML = `
      <div class="chat-avatar">
        ${g.icon ? `<img src="${g.icon}">` : `<div class="blank-avatar" style="background: ${avatarColor}">${initials}</div>`}
      </div>
      <div class="chat-info">
        <b>${g.name}</b>
        <div class="chat-status">${lastText || ((g.members?.length || 0) + " participants")}</div>
      </div>
      <div class="chat-meta">
        <span class="time">${lastTime}</span>
      </div>
    `;

    div.onclick = () => openGroupChat(g);
    chatList.appendChild(div);
  });

  reorderChatList();
}

document.getElementById("createGroupBtn")?.addEventListener("click", () => {
  const name = document.getElementById("groupName").value.trim();
  const membersRaw = document.getElementById("groupMembers").value.trim();

  if (!name) {
    alert("Group name required");
    return;
  }

  const members = membersRaw
    ? membersRaw.split(",").map(m => m.trim()).filter(Boolean)
    : [];

  // 🔥 SERVER KO GROUP CREATE BHEJO (MOST IMPORTANT)
  socket.emit("createGroup", {
    name,
    members,
    createdBy: myPhone
  });

  // UI reset
  document.getElementById("groupName").value = "";
  document.getElementById("groupMembers").value = "";
});


document.getElementById("pickGroupMembers")?.addEventListener("click", () => {
  openMemberPicker({
    selected: [],
    title: "Select members",
    onSave: phones => {
      document.getElementById("groupMembers").value = phones.join(", ");
    }
  });
});

renderGroups();

/* ================= SETTINGS ================= */
const themeRadios = document.querySelectorAll('input[name="theme"]');
const themeKey = `wa-theme-${myPhone}`;

function applyTheme(theme) {
  if (theme === "dark") {
    document.body.classList.add("dark");
  } else {
    document.body.classList.remove("dark");
  }
}

const savedTheme = localStorage.getItem(themeKey) || "light";
applyTheme(savedTheme);
themeRadios.forEach(radio => {
  radio.checked = radio.value === savedTheme;
  radio.addEventListener("change", e => {
    localStorage.setItem(themeKey, e.target.value);
    applyTheme(e.target.value);
  });
});

/* ================= SETTINGS PROFILE CARD ================= */
function refreshSettingsCard() {
  fetch(`http://localhost:3000/profile/${myPhone}`)
    .then(res => res.json())
    .then(user => {
      const nameEl = document.getElementById("settingsProfileName");
      const aboutEl = document.getElementById("settingsProfileAbout");
      const picEl = document.getElementById("settingsProfilePic");
      if (nameEl) nameEl.innerText = user.name || myPhone;
      if (aboutEl) aboutEl.innerText = user.about || "Hey there! I am using WhatsApp.";
      if (picEl) {
        picEl.innerHTML = user.photo
          ? `<img src="${user.photo}" style="width:100%;height:100%;object-fit:cover">`
          : `<span class="material-icons">person</span>`;
      }
    });
}

document.getElementById("settingsProfileCard")?.addEventListener("click", openProfile);
refreshSettingsCard();

// ✅ FINAL LOGOUT FUNCTION (100% WORKING)
window.doLogout = function() {
  console.log("✅ LOGOUT CLICKED");

  // clear login data
  localStorage.removeItem("isLoggedIn");
  localStorage.removeItem("phone");
  sessionStorage.clear();

  // redirect
  window.location.href = "/login.html";
};

function showDeleteMenu(x, y, msg) {
  document.getElementById("deleteMenu")?.remove();

  const menu = document.createElement("div");
  menu.id = "deleteMenu";
  menu.style = `
    position:fixed;
    top:${y}px;
    left:${x}px;
    background:#233138;
    color:#fff;
    border-radius:8px;
    z-index:9999;
    width:180px;
  `;

  menu.innerHTML = `
    <div class="del" onclick="deleteForMe('${msg._id}')">Delete for me</div>
    ${
      msg.from === myPhone
        ? `<div class="del" onclick="deleteForEveryone('${msg._id}')">Delete for everyone</div>`
        : ""
    }
  `;

  document.body.appendChild(menu);

  document.addEventListener("click", () => menu.remove(), { once: true });
}

function deleteForMe(id) {
  socket.emit("deleteForMe", {
    messageId: id,
    phone: myPhone
  });

  // remove from DOM
  document.querySelector(`[data-id="${id}"]`)?.remove();

  // also clean from local group storage if it was a group message
  Object.keys(groupMessages).forEach(groupId => {
    const before = groupMessages[groupId] || [];
    const after = before.filter(m => m._id !== id);
    if (after.length !== before.length) {
      groupMessages[groupId] = after;
    }
  });
  saveGroupMessages();
}

function deleteForEveryone(id) {
  // backend will flip message text + flag and broadcast to both users
  socket.emit("deleteForEveryone", { messageId: id });

  // for local group chats (no backend), treat as delete for me
  Object.keys(groupMessages).forEach(groupId => {
    const before = groupMessages[groupId] || [];
    const after = before.filter(m => m._id !== id);
    if (after.length !== before.length) {
      groupMessages[groupId] = after;
      // update DOM for group messages
      const el = document.querySelector(`[data-id="${id}"]`);
      if (el) el.innerHTML = `<i style="color:#667781;font-size:13px">This message was deleted</i>`;
    }
  });
  saveGroupMessages();
}

socket.on("messageDeletedEveryone", msg => {
  const el = document.querySelector(`[data-id="${msg._id}"]`);
  if (!el) return;

  el.innerHTML = `<i style="color:#667781;font-size:13px">This message was deleted</i>`;
});

function saveChatPrefs() {
  localStorage.setItem(chatPrefsKey, JSON.stringify(chatPrefs));
}

async function toggleBlock(target, shouldBlock) {
  await fetch("http://localhost:3000/block", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ me: myPhone, target, block: shouldBlock })
  });
  chatState[target] = { ...(chatState[target] || {}), blocked: shouldBlock };
  loadUsers();
}

async function toggleFavourite(target, add) {
  await fetch("http://localhost:3000/favourites/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ me: myPhone, target, add })
  });
  chatState[target] = { ...(chatState[target] || {}), favourite: add };
  loadUsers();
}

async function markChatUnread(phone, node) {
  await fetch("http://localhost:3000/chats/mark-unread", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ me: myPhone, other: phone })
  });
  applyChatPrefs(node, phone, { unread: true });
}

async function markChatRead(phone, node) {
  await fetch("http://localhost:3000/chats/mark-read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ me: myPhone, other: phone })
  });
  applyChatPrefs(node, phone, { unread: false });
}

function reorderChatList() {
  if (!chatList) return;

  const nodes = Array.from(chatList.children);

  nodes.sort((a, b) => {
    // 🔥 FIX: phone OR groupId
    const keyA = a.dataset.phone || a.dataset.groupId;
    const keyB = b.dataset.phone || b.dataset.groupId;

    const prefA = chatPrefs[keyA] || {};
    const prefB = chatPrefs[keyB] || {};

    const pinnedDiff = (prefB.pinned ? 1 : 0) - (prefA.pinned ? 1 : 0);
    if (pinnedDiff !== 0) return pinnedDiff;

    const archivedDiff = (prefA.archived ? 1 : 0) - (prefB.archived ? 1 : 0);
    if (archivedDiff !== 0) return archivedDiff;

    const lastA = Number(a.dataset.last || 0);
    const lastB = Number(b.dataset.last || 0);
    return lastB - lastA;
  });

  nodes.forEach(n => chatList.appendChild(n));
  refreshGlobalUnreadIndicator();
}

// ================= RENDER FILE MESSAGE =================
function renderFileMessage(file) {
  const div = document.createElement("div");
  const mine = file.from === myPhone;

  div.className = "msg " + (mine ? "sent" : "received");
  div.dataset.id = file._id;

  // Support both 'data' and 'fileData' properties
  const fileData = file.data || file.fileData;

  div.oncontextmenu = (e) => {
    e.preventDefault();
    showDeleteMenu(e.pageX, e.pageY, file);
  };

  let content = "";

  // IMAGE
  if (file.fileType === "media" && file.mimeType && file.mimeType.startsWith("image")) {
    content = `<img src="${fileData}" style="max-width:220px;border-radius:10px">`;
  }

  // AUDIO
  else if (file.fileType === "audio") {
    content = `<audio controls src="${fileData}" style="width:220px"></audio>`;
  }

  // DOCUMENT
  else {
    content = `
      <a href="${fileData}" download="${file.fileName || 'file'}"
         style="text-decoration:none;font-weight:600;color:#111">
        📄 ${file.fileName || 'Document'}
      </a>
    `;
  }

  div.innerHTML = `
    ${content}
    <small>
      ${new Date(file.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      })}
      ${mine ? `<span class="tick">✓✓</span>` : ""}
    </small>
  `;

  messagesBox.appendChild(div);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}


function applyChatPrefs(node, phone, overrides = {}) {
  const prefs = { ...(chatPrefs[phone] || {}), ...overrides };
  if (!node) return;
  node.dataset.pinned = prefs.pinned ? "1" : "0";
  node.dataset.archived = prefs.archived ? "1" : "0";
  node.classList.toggle("archived", !!prefs.archived);
  const info = node.querySelector(".chat-status");
  if (prefs.blocked && info) info.innerText = "Blocked";
  if (prefs.blockedBy && info) info.innerText = "Blocked you";
  if (prefs.favourite) {
    const nameEl = node.querySelector("b");
    if (nameEl && !nameEl.querySelector(".fav-dot")) {
      nameEl.insertAdjacentHTML("beforeend", `<span class="fav-dot"></span>`);
    }
  }
  if (prefs.unread) {
    if (!node.querySelector(".unread-badge")) {
      node.querySelector(".chat-meta")?.insertAdjacentHTML(
        "beforeend",
        `<span class="unread-badge">1</span>`
      );
    }
  } else if (prefs.unread === false) {
    node.querySelector(".unread-badge")?.remove();
  }
}

function showChatMenu(x, y, user, node) {
  document.getElementById("chatContextMenu")?.remove();
  const menu = document.createElement("div");
  menu.id = "chatContextMenu";
  menu.className = "context-menu";
  menu.style.top = y + "px";
  menu.style.left = x + "px";
  const state = chatState[user.phone] || {};
  const prefs = chatPrefs[user.phone] || {};
  const hasUnread = !!node.querySelector(".unread-badge");
  const items = [
    [prefs.archived ? "unarchive" : "archive", prefs.archived ? "Unarchive chat" : "Archive chat"],
    ["mute", "Mute notifications"],
    [prefs.pinned ? "unpin" : "pin", prefs.pinned ? "Unpin chat" : "Pin chat"],
    [hasUnread ? "mark-read" : "unread", hasUnread ? "Mark as read" : "Mark as unread"],
    [state.favourite ? "unfavourite" : "favourite", state.favourite ? "Remove from favourites" : "Add to favourites"],
    [state.blocked ? "unblock" : "block", state.blocked ? "Unblock" : "Block"],
    ["delete", "Delete chat"]
  ];
  menu.innerHTML = items
    .map(
      ([key, label]) =>
        `<div class="item" data-action="${key}"><span class="material-icons">chevron_right</span>${label}</div>`
    )
    .join("");
  document.body.appendChild(menu);

  // keep menu fully visible – flip upwards if near bottom
  const rect = menu.getBoundingClientRect();
  const overflowY = rect.bottom - window.innerHeight;
  if (overflowY > 0) {
    const adjustedTop = Math.max(8, y - overflowY - 8);
    menu.style.top = adjustedTop + "px";
  }

  menu.addEventListener("click", e => {
    const action = e.target.closest(".item")?.dataset.action;
    if (!action) return;
    const prefs = chatPrefs[user.phone] || {};
    let shouldReorder = false;
    switch (action) {
      case "archive":
        prefs.archived = true;
        node.style.opacity = 0.6;
        shouldReorder = true;
        break;
      case "unarchive":
        prefs.archived = false;
        node.style.opacity = 1;
        shouldReorder = true;
        break;
      case "mute":
        prefs.muted = true;
        alert("Muted");
        break;
      case "pin":
        prefs.pinned = true;
        shouldReorder = true;
        break;
      case "unpin":
        prefs.pinned = false;
        shouldReorder = true;
        break;
      case "unread":
        markChatUnread(user.phone, node);
        break;
      case "mark-read":
        markChatRead(user.phone, node);
        break;
      case "favourite":
        toggleFavourite(user.phone, true);
        break;
      case "unfavourite":
        toggleFavourite(user.phone, false);
        break;
      case "block":
        toggleBlock(user.phone, true);
        break;
      case "unblock":
        toggleBlock(user.phone, false);
        break;
      case "delete":
        node.remove();
        if (!hiddenChats.includes(user.phone)) {
          hiddenChats.push(user.phone);
          localStorage.setItem(hiddenChatsKey, JSON.stringify(hiddenChats));
        }
        if (currentChat === user.phone) {
          closeChat();
        }
        break;
    }
    chatPrefs[user.phone] = prefs;
    saveChatPrefs();
    if (shouldReorder) reorderChatList();
    menu.remove();
  });

  document.addEventListener(
    "click",
    () => {
      menu.remove();
    },
    { once: true }
  );
}


// ================= FILE INPUT HANDLERS =================
// NOTE: actual binding is (re)done after DOMContentLoaded so elements exist.
const fileDocument = document.getElementById("fileDocument");
const fileImage = document.getElementById("fileImage");
const fileAudio = document.getElementById("fileAudio");

function sendFile(file, type) {
  if (!file || !currentChat) {
  alert("❌ Pehle chat select karo");
  return;
}


  const reader = new FileReader();
  reader.onload = () => {
    socket.emit("sendFile", {
      from: myPhone,
      to: currentChat,
      fileName: file.name,
      fileType: type,
      mimeType: file.type,
      data: reader.result, // base64
      createdAt: Date.now(),
      isGroup: !!currentChatMeta?.isGroup
    });
  };
  reader.readAsDataURL(file);
}

function bindFileInput(input, type) {
  if (!input) return;

  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;

    console.log("✅ File selected:", file.name);

    sendFile(file, type);

    // 🔥 VERY IMPORTANT (reset input)
    input.value = "";
  };
}

// Initial bind (will be a no-op on first load because inputs are defined
// later in the HTML, but kept for safety if HTML order changes).
bindFileInput(fileDocument, "document");
bindFileInput(fileImage, "media");
bindFileInput(fileAudio, "audio");


document.addEventListener("DOMContentLoaded", () => {

  const attachBtn = document.getElementById("attachBtn");
  const attachMenu = document.getElementById("attachMenu");
  const fileDocument = document.getElementById("fileDocument");
  const fileImage = document.getElementById("fileImage");
  const fileAudio = document.getElementById("fileAudio");

  if (!attachBtn || !attachMenu) {
    console.warn("❌ Attach elements not found");
    return;
  }

  // Ensure file inputs actually send files when user selects them
  bindFileInput(fileDocument, "document");
  bindFileInput(fileImage, "media");
  bindFileInput(fileAudio, "audio");

  // 📎 attach icon click
  attachBtn.addEventListener("click", e => {
    e.stopPropagation();
    attachMenu.classList.toggle("hidden");
  });

  // attach menu item click
  document.querySelectorAll(".attach-item").forEach(item => {
    item.addEventListener("click", () => {
      const type = item.dataset.type;
      attachMenu.classList.add("hidden");

      if (type === "document") fileDocument?.click();
      if (type === "image") fileImage?.click();
      if (type === "audio") fileAudio?.click();
    });
  });

  // outside click = close menu
  document.addEventListener("click", () => {
    attachMenu.classList.add("hidden");
  });
});
