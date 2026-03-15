// Generate or retrieve persistent user ID
let userId = localStorage.getItem("user_id");
if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem("user_id", userId);
}

let ws = null;
let isConnected = false;
let reconnectAttempts = 0;
let reconnectDelay = 2000;
const maxReconnectAttempts = 10;

let currentChatId = null;

const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const charCount = document.getElementById("charCount");
const heroSection = document.getElementById("heroSection");
const newChatBtn = document.getElementById("newChatBtn");
const chatList = document.getElementById("chatList");
const toggleSidebarBtn = document.getElementById("toggleSidebar");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const mobileBreakpoint = window.matchMedia("(max-width: 768px)");

const isMobileView = () => mobileBreakpoint.matches;

const syncSidebarBackdrop = () => {
    if (!sidebarBackdrop) {
        return;
    }

    const showBackdrop = isMobileView() && !sidebar.classList.contains("closed");
    sidebarBackdrop.classList.toggle("visible", showBackdrop);
};

const setSidebarOpen = (isOpen) => {
    sidebar.classList.toggle("closed", !isOpen);
    toggleSidebarBtn.setAttribute("aria-expanded", String(isOpen));
    syncSidebarBackdrop();
};

let previousIsMobile = isMobileView();

const syncSidebarForViewport = () => {
    const nowMobile = isMobileView();
    if (nowMobile !== previousIsMobile) {
        setSidebarOpen(!nowMobile);
        previousIsMobile = nowMobile;
    } else {
        syncSidebarBackdrop();
    }
};

const scrollToLatest = () => {
    requestAnimationFrame(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
};

const enterChatMode = () => {
    if (document.body.classList.contains("chat-mode")) {
        return;
    }

    document.body.classList.remove("initial-mode");
    document.body.classList.add("chat-mode");
    heroSection.setAttribute("aria-hidden", "true");
    chatMessages.classList.remove("d-none");
};

const escapeHtml = (text) =>
    text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

const formatText = (text) =>
    escapeHtml(text)
        .replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>')
        .replace(/\n/g, "<br>");

const renderAssistantContent = (node, raw) => {
    const codeFenceRegex = /```([\w+-]*)\n?([\s\S]*?)```/g;
    let html = "";
    let cursor = 0;
    let match;

    while ((match = codeFenceRegex.exec(raw)) !== null) {
        const plain = raw.slice(cursor, match.index);
        if (plain) {
            html += formatText(plain);
        }

        const language = (match[1] || "code").trim();
        const code = escapeHtml(match[2].trimEnd());
        html += `
            <div class="code-block border border-secondary-subtle rounded-3 overflow-hidden my-2 bg-black">
                <div class="d-flex justify-content-between align-items-center px-2 py-1 border-bottom border-secondary-subtle small text-secondary bg-dark">
                    <span>${language}</span>
                    <button type="button" class="copy-code-btn btn btn-outline-light btn-sm py-0 px-2">Copy</button>
                </div>
                <pre class="overflow-auto"><code>${code}</code></pre>
            </div>
        `;

        cursor = match.index + match[0].length;
    }

    const tail = raw.slice(cursor);
    if (tail) {
        html += formatText(tail);
    }

    node.innerHTML = html || "&nbsp;";
};

const addMessage = (role, content = "") => {
    enterChatMode();

    const row = document.createElement("div");
    row.className = `message-group d-flex ${role === "user" ? "justify-content-end" : "justify-content-start"} ${role}`;

    const bubble = document.createElement("div");
    bubble.className = role === "user" ? "user-msg" : "bot-msg";

    if (role === "user") {
        bubble.textContent = content;
    } else {
        bubble.dataset.rawContent = content;
        renderAssistantContent(bubble, content);
    }

    row.appendChild(bubble);
    chatMessages.appendChild(row);
    scrollToLatest();
    return bubble;
};

const appendStream = (chunk) => {
    const botMessages = document.querySelectorAll(".message-group.bot .bot-msg");
    if (!botMessages.length) {
        return;
    }

    const last = botMessages[botMessages.length - 1];
    const nextRaw = (last.dataset.rawContent || "") + chunk;
    last.dataset.rawContent = nextRaw;
    renderAssistantContent(last, nextRaw);
    scrollToLatest();
};

const clearChat = () => {
    chatMessages.innerHTML = "";
    document.body.classList.remove("chat-mode");
    document.body.classList.add("initial-mode");
    heroSection.removeAttribute("aria-hidden");
};

const setInputState = (disabled) => {
    sendBtn.disabled = disabled;
    messageInput.disabled = disabled;
};

const attemptReconnect = () => {
    if (reconnectAttempts >= maxReconnectAttempts) {
        addMessage("bot", "❌ Unable to connect. Please refresh the page.");
        return;
    }

    reconnectAttempts += 1;
    setTimeout(connectWebSocket, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
};

const connectWebSocket = () => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
        ws = new WebSocket(wsUrl);
    } catch (error) {
        console.error("Failed to create WebSocket:", error);
        attemptReconnect();
        return;
    }

    ws.onopen = () => {
        isConnected = true;
        reconnectAttempts = 0;
        reconnectDelay = 2000;
        setInputState(false);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === "stream") {
                appendStream(data.content);
            } else if (data.type === "complete") {
                setInputState(false);
                scrollToLatest();
            } else if (data.type === "error") {
                addMessage("bot", `❌ Error: ${data.content}`);
                setInputState(false);
                scrollToLatest();
            }
        } catch (error) {
            console.error("Error parsing message:", error);
        }
    };

    ws.onerror = () => {
        isConnected = false;
    };

    ws.onclose = () => {
        isConnected = false;
        attemptReconnect();
    };
};

const sendMessage = async () => {
    const text = messageInput.value.trim();
    if (!text || !isConnected) {
        if (!isConnected) {
            alert("Not connected to server. Trying to reconnect...");
        }
        return;
    }

    // Auto-create chat if one doesn't exist
    if (!currentChatId) {
        try {
            const res = await fetch("/new_chat", { 
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    user_id: userId
                })
            });
            const data = await res.json();
            currentChatId = data.chat_id;
            
            // Refresh sidebar with new chat
            await loadChatList();
        } catch (error) {
            console.error("Failed to create chat:", error);
            alert("Failed to create chat. Please try again.");
            return;
        }
    }

    enterChatMode();
    addMessage("user", text);
    addMessage("bot", "");
    messageInput.value = "";
    messageInput.style.height = "auto";
    charCount.textContent = "0";
    setInputState(true);
    
    // Send message with chat_id and user_id
    ws.send(JSON.stringify({ 
        user_id: userId,
        chat_id: currentChatId,
        content: text 
    }));
};

const createNewChat = async () => {
    try {
        const response = await fetch("/new_chat", { 
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                user_id: userId
            })
        });
        const data = await response.json();
        currentChatId = data.chat_id;
        clearChat();
        await loadChatList();
        if (isMobileView()) {
            setSidebarOpen(false);
        }
        setInputState(false);
    } catch (error) {
        console.error("Failed to create new chat:", error);
        alert("Failed to create new chat");
    }
};

const loadChatList = async () => {
    try {
        const response = await fetch(`/chats/${userId}`);
        const chats = await response.json();
        
        chatList.innerHTML = "";
        
        if (chats.length === 0) {
            chatList.innerHTML = '<div class="text-secondary p-3 text-center small">No chats yet</div>';
            return;
        }
        
        chats.forEach(chat => {
            const chatItem = document.createElement("div");
            chatItem.className = "chat-item";
            chatItem.dataset.id = chat.chat_id;
            chatItem.dataset.chatId = chat.chat_id;
            
            const titleSpan = document.createElement("span");
            titleSpan.className = "chat-title";
            titleSpan.textContent = chat.title;
            titleSpan.title = chat.title;
            
            const menuBtn = document.createElement("button");
            menuBtn.className = "chat-menu-btn";
            menuBtn.type = "button";
            menuBtn.textContent = "⋯";
            
            const menu = document.createElement("div");
            menu.className = "chat-menu";
            
            const renameBtn = document.createElement("button");
            renameBtn.className = "rename-chat";
            renameBtn.type = "button";
            renameBtn.textContent = "Rename";
            
            const deleteBtn = document.createElement("button");
            deleteBtn.className = "delete-chat";
            deleteBtn.type = "button";
            deleteBtn.textContent = "Delete";
            
            menu.appendChild(renameBtn);
            menu.appendChild(deleteBtn);
            
            chatItem.appendChild(titleSpan);
            chatItem.appendChild(menuBtn);
            chatItem.appendChild(menu);
            
            if (chat.chat_id === currentChatId) {
                chatItem.classList.add("active");
            }
            
            titleSpan.addEventListener("click", () => loadChatMessages(chat.chat_id));
            chatList.appendChild(chatItem);
        });
    } catch (error) {
        console.error("Failed to load chats:", error);
    }
};

const loadChatMessages = async (chatId) => {
    try {
        const response = await fetch(`/chat/${chatId}`);
        
        if (!response.ok) {
            alert("Failed to load chat");
            return;
        }
        
        const messages = await response.json();
        
        clearChat();
        currentChatId = chatId;
        
        // Update active state in sidebar
        document.querySelectorAll(".chat-item").forEach(item => {
            item.classList.remove("active");
            if (item.dataset.chatId === chatId) {
                item.classList.add("active");
            }
        });
        
        if (messages.length > 0) {
            enterChatMode();
            messages.forEach(msg => {
                addMessage(msg.role, msg.content);
            });
        }

        if (isMobileView()) {
            setSidebarOpen(false);
        }

        setInputState(false);
    } catch (error) {
        console.error("Failed to load chat messages:", error);
        alert("Failed to load chat");
    }
};

messageInput.addEventListener("input", () => {
    messageInput.style.height = "auto";
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
    charCount.textContent = messageInput.value.length;
});

chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage();
});

sendBtn.addEventListener("click", sendMessage);

messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
});

chatMessages.addEventListener("click", async (event) => {
    const button = event.target.closest(".copy-code-btn");
    if (!button) {
        return;
    }

    const code = button.closest(".code-block")?.querySelector("code")?.textContent || "";
    if (!code) {
        return;
    }

    try {
        await navigator.clipboard.writeText(code);
        button.textContent = "Copied!";
        setTimeout(() => {
            button.textContent = "Copy";
        }, 1200);
    } catch (error) {
        console.error("Copy failed:", error);
    }
});

newChatBtn.addEventListener("click", createNewChat);

toggleSidebarBtn.addEventListener("click", () => {
    const shouldOpen = sidebar.classList.contains("closed");
    setSidebarOpen(shouldOpen);
});

sidebarBackdrop?.addEventListener("click", () => {
    setSidebarOpen(false);
});

window.addEventListener("resize", syncSidebarForViewport);

// Menu toggle handler
document.addEventListener("click", (e) => {
    if (e.target.classList.contains("chat-menu-btn")) {
        const menu = e.target.nextElementSibling;
        const isVisible = menu.style.display === "flex";
        
        // Close all other menus
        document.querySelectorAll(".chat-menu").forEach(m => {
            m.style.display = "none";
        });
        
        // Toggle current menu
        menu.style.display = isVisible ? "none" : "flex";
        e.stopPropagation();
    } else if (!e.target.closest(".chat-menu")) {
        // Close menu if clicking outside
        document.querySelectorAll(".chat-menu").forEach(m => {
            m.style.display = "none";
        });
    }
});

// Rename chat handler
document.addEventListener("click", (e) => {
    if (e.target.classList.contains("rename-chat")) {
        const chatId = e.target.closest(".chat-item").dataset.id;
        const newName = prompt("Rename chat to:");
        
        if (!newName) return;
        
        fetch(`/chat/${chatId}/rename`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: newName }),
        }).then(() => loadChatList());
    }
});

// Delete chat handler
document.addEventListener("click", (e) => {
    if (e.target.classList.contains("delete-chat")) {
        const chatId = e.target.closest(".chat-item").dataset.id;
        
        if (!confirm("Delete this chat?")) return;
        
        fetch(`/chat/${chatId}`, {
            method: "DELETE",
        }).then(() => {
            if (currentChatId === chatId) {
                currentChatId = null;
                clearChat();
            }
            loadChatList();
        });
    }
});

window.addEventListener("load", async () => {
    setSidebarOpen(!isMobileView());
    connectWebSocket();
    await loadChatList();
    // Auto-create first chat if none exist
    setTimeout(async () => {
        const response = await fetch(`/chats/${userId}`);
        const chats = await response.json();
        if (chats.length === 0) {
            await createNewChat();
        }
    }, 500);
});
