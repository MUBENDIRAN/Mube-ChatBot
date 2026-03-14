let ws = null;
let isConnected = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
let reconnectDelay = 2000;

const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const themeToggle = document.getElementById("themeToggle");
const charCount = document.getElementById("charCount");

// Theme Management
const initializeTheme = () => {
    const savedTheme = localStorage.getItem("theme") || "light";
    document.documentElement.classList.toggle("dark-mode", savedTheme === "dark");
    updateThemeButton(savedTheme === "dark");
};

const updateThemeButton = (isDark) => {
    themeToggle.textContent = isDark ? "☀️" : "🌙";
};

const toggleTheme = () => {
    const isDark = document.documentElement.classList.toggle("dark-mode");
    localStorage.setItem("theme", isDark ? "dark" : "light");
    updateThemeButton(isDark);
};

themeToggle.addEventListener("click", toggleTheme);
initializeTheme();

// Auto-resize textarea
messageInput.addEventListener("input", () => {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + "px";
    charCount.textContent = messageInput.value.length;
});

// Connect to WebSocket
const connectWebSocket = () => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            isConnected = true;
            reconnectAttempts = 0;
            reconnectDelay = 2000;
            sendBtn.disabled = false;
            messageInput.disabled = false;
            console.log("✓ Connected to server");
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === "stream") {
                    // Find the last bot message content div
                    const botMessages = document.querySelectorAll(".message-group.bot .bot-msg");
                    if (botMessages.length > 0) {
                        const lastBotMsg = botMessages[botMessages.length - 1];
                        lastBotMsg.textContent += data.content;
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                    }
                } else if (data.type === "complete") {
                    sendBtn.disabled = false;
                    messageInput.disabled = false;
                } else if (data.type === "error") {
                    addMessage("bot", `❌ Error: ${data.content}`);
                    sendBtn.disabled = false;
                    messageInput.disabled = false;
                }
            } catch (e) {
                console.error("Error parsing message:", e);
            }
        };

        ws.onerror = (error) => {
            console.error("WebSocket error:", error);
            isConnected = false;
        };

        ws.onclose = () => {
            isConnected = false;
            console.log("Disconnected from server");
            attemptReconnect();
        };
    } catch (error) {
        console.error("Failed to create WebSocket:", error);
        attemptReconnect();
    }
};

// Reconnect with exponential backoff
const attemptReconnect = () => {
    if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        console.log(`Reconnecting... ${reconnectAttempts}/${maxReconnectAttempts}`);
        setTimeout(connectWebSocket, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
    } else {
        addMessage("bot", "❌ Unable to connect. Please refresh the page.");
    }
};

// Add message to chat
const addMessage = (role, content) => {
    const messageGroup = document.createElement("div");
    messageGroup.className = `message-group ${role}`;

    const messageDiv = document.createElement("div");
    messageDiv.className = role === "user" ? "user-msg" : "bot-msg";
    messageDiv.textContent = content;

    messageGroup.appendChild(messageDiv);
    chatMessages.appendChild(messageGroup);
    chatMessages.scrollTop = chatMessages.scrollHeight;
};

// Send message
const sendMessage = () => {
    const message = messageInput.value.trim();

    if (!message || !isConnected) {
        if (!isConnected) alert("Not connected to server. Trying to reconnect...");
        return;
    }

    // 1. Add user message first
    addMessage("user", message);

    // 2. Create empty bot message bubble that will receive streaming content
    const messageGroup = document.createElement("div");
    messageGroup.className = "message-group bot";
    const messageDiv = document.createElement("div");
    messageDiv.className = "bot-msg";
    messageDiv.textContent = "";
    messageGroup.appendChild(messageDiv);
    chatMessages.appendChild(messageGroup);

    // 3. Clear input and disable
    messageInput.value = "";
    messageInput.style.height = "auto";
    charCount.textContent = "0";
    sendBtn.disabled = true;
    messageInput.disabled = true;

    // 4. Send message to server
    ws.send(JSON.stringify({ content: message }));
    
    chatMessages.scrollTop = chatMessages.scrollHeight;
};

// Event listeners
chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage();
});

sendBtn.addEventListener("click", sendMessage);

messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

window.addEventListener("load", connectWebSocket);
