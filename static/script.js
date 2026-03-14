let ws = null;
let isConnected = false;
let reconnectAttempts = 0;
let reconnectDelay = 2000;
const maxReconnectAttempts = 10;

const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const charCount = document.getElementById("charCount");
const heroSection = document.getElementById("heroSection");

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

const sendMessage = () => {
    const text = messageInput.value.trim();
    if (!text || !isConnected) {
        if (!isConnected) {
            alert("Not connected to server. Trying to reconnect...");
        }
        return;
    }

    enterChatMode();
    addMessage("user", text);
    addMessage("bot", "");
    messageInput.value = "";
    messageInput.style.height = "auto";
    charCount.textContent = "0";
    setInputState(true);
    ws.send(JSON.stringify({ content: text }));
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

window.addEventListener("load", connectWebSocket);
