/* ============================================================================
   Northwind Support chat widget — client.
   - One WebSocket to /ws. Per turn: send {type:"turn"}, receive thinking →
     brain → reply.
   - Left pane renders the chat (bubbles + typing indicator).
   - Right pane animates the Brain trace: memory recall, RAG, routing, source,
     and the "wrote turn to memory" confirmation.
   ========================================================================== */

(() => {
  "use strict";

  const USER_ID = "acme-customer"; // stable so memory persists across turns
  let TURN = 0;

  const messagesEl = document.getElementById("messages");
  const brainBody = document.getElementById("brainBody");
  const brainIdle = document.getElementById("brainIdle");
  const form = document.getElementById("composer");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const dimBadge = document.getElementById("dimBadge");
  const srcBadge = document.getElementById("srcBadge");
  const brandTitle = document.getElementById("brandTitle");
  const brandAvatar = document.getElementById("brandAvatar");

  let ws = null;
  let awaiting = false;
  let typingEl = null;
  let currentTurnBlock = null;

  // ---------------------------------------------------------------- helpers
  function nowStamp() {
    const d = new Date();
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
  }

  function scrollChat() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function scrollBrain() {
    brainBody.scrollTop = brainBody.scrollHeight;
  }

  function addMessage(role, text) {
    const row = document.createElement("div");
    row.className = `row ${role}`;

    if (role === "agent") {
      const av = document.createElement("div");
      av.className = "av";
      av.textContent = "🎧";
      row.appendChild(av);
    }

    const wrap = document.createElement("div");
    wrap.className = "bubble-wrap";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    wrap.appendChild(bubble);

    const ts = document.createElement("div");
    ts.className = "ts";
    ts.textContent = nowStamp();
    wrap.appendChild(ts);

    row.appendChild(wrap);
    messagesEl.appendChild(row);
    scrollChat();
    return row;
  }

  function showTyping() {
    hideTyping();
    const row = document.createElement("div");
    row.className = "row agent";
    row.dataset.typing = "1";
    const av = document.createElement("div");
    av.className = "av";
    av.textContent = "🎧";
    row.appendChild(av);
    const wrap = document.createElement("div");
    wrap.className = "bubble-wrap";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    const typing = document.createElement("div");
    typing.className = "typing";
    typing.innerHTML = "<span></span><span></span><span></span>";
    bubble.appendChild(typing);
    wrap.appendChild(bubble);
    row.appendChild(wrap);
    messagesEl.appendChild(row);
    typingEl = row;
    scrollChat();
  }

  function hideTyping() {
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
    typingEl = null;
  }

  // --------------------------------------------------------- brain rendering
  function startTurnBlock(query) {
    if (brainIdle) brainIdle.style.display = "none";
    TURN += 1;
    const block = document.createElement("div");
    block.className = "turn-block";
    const label = document.createElement("div");
    label.className = "turn-label";
    label.textContent = `turn ${TURN}`;
    block.appendChild(label);
    const echo = document.createElement("span");
    echo.className = "query-echo";
    echo.textContent = `"${query}"`;
    block.appendChild(echo);
    brainBody.appendChild(block);
    currentTurnBlock = block;
    scrollBrain();
  }

  function section(icon, title) {
    const sec = document.createElement("div");
    sec.className = "section";
    const head = document.createElement("div");
    head.className = "sec-head";
    head.innerHTML = `<span class="sec-icon">${icon}</span> ${title}`;
    sec.appendChild(head);
    return sec;
  }

  function dimLine(text) {
    const ln = document.createElement("div");
    ln.className = "line dim";
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = text;
    ln.appendChild(lbl);
    return ln;
  }

  function fmtScore(s) {
    return (typeof s === "number" ? s : 0).toFixed(2);
  }

  // animate sections in sequence so the brain "reasons" before the reply
  function renderBrain(data) {
    const block = currentTurnBlock;
    if (!block) return;

    const steps = [];

    // 1. Memory recall
    steps.push(() => {
      const sec = section("🧩", "Memory recall");
      const mem = data.recalled_memory || [];
      if (!mem.length) {
        sec.appendChild(dimLine("nothing yet — first time this user said this"));
      } else {
        mem.forEach((m, i) => {
          const ln = document.createElement("div");
          ln.className = "line" + (i === 0 ? " recalled-hit" : "");
          const lbl = document.createElement("span");
          lbl.className = "lbl";
          let txt = m.content || "";
          if (txt.length > 64) txt = txt.slice(0, 64) + "…";
          lbl.innerHTML = `<span class="role-tag">[${m.role}]</span> ${escapeHtml(txt)}`;
          const score = document.createElement("span");
          score.className = "score";
          score.textContent = fmtScore(m.score);
          ln.appendChild(lbl);
          ln.appendChild(score);
          sec.appendChild(ln);
        });
      }
      block.appendChild(sec);
      scrollBrain();
    });

    // 2. Knowledge base (RAG)
    steps.push(() => {
      const sec = section("📚", "Knowledge base (RAG)");
      const kb = data.kb_hits || [];
      if (!kb.length) {
        sec.appendChild(dimLine("no KB article cleared the threshold"));
      } else {
        kb.forEach((d) => {
          const ln = document.createElement("div");
          ln.className = "line";
          const lbl = document.createElement("span");
          lbl.className = "lbl";
          lbl.textContent = d.title || "(untitled)";
          const score = document.createElement("span");
          score.className = "score";
          score.textContent = fmtScore(d.score);
          ln.appendChild(lbl);
          ln.appendChild(score);
          sec.appendChild(ln);
        });
      }
      block.appendChild(sec);
      scrollBrain();
    });

    // 3. Routing
    steps.push(() => {
      const sec = section("🧭", "Routing (semantic tool-select)");
      const route = data.route || [];
      route.forEach(([name, sc]) => {
        const ln = document.createElement("div");
        ln.className = "line" + (name === data.chosen_tool ? " chosen" : "");
        const lbl = document.createElement("span");
        lbl.className = "lbl";
        lbl.textContent = name;
        if (name === data.chosen_tool) {
          const pick = document.createElement("span");
          pick.className = "pick";
          pick.textContent = "← chosen";
          lbl.appendChild(pick);
        }
        const score = document.createElement("span");
        score.className = "score";
        score.textContent = fmtScore(sc);
        ln.appendChild(lbl);
        ln.appendChild(score);
        sec.appendChild(ln);
      });
      block.appendChild(sec);
      scrollBrain();
    });

    // 4. Source (the LLM behind the reply)
    steps.push(() => {
      const sec = section("⚙️", "Source");
      const ln = document.createElement("div");
      ln.className = "source-line";
      ln.innerHTML = `reply via <strong>${escapeHtml(data.source || "—")}</strong>`;
      sec.appendChild(ln);
      block.appendChild(sec);
      scrollBrain();
    });

    // 5. wrote turn to memory
    steps.push(() => {
      const sec = document.createElement("div");
      sec.className = "section";
      const ln = document.createElement("div");
      ln.className = "wrote-line";
      ln.innerHTML = `<span class="chk">✓</span> wrote turn to memory <span style="opacity:.6">(${data.embed_dim}-dim)</span>`;
      sec.appendChild(ln);
      block.appendChild(sec);
      scrollBrain();
    });

    // play the steps with small delays
    let i = 0;
    const tick = () => {
      if (i < steps.length) {
        steps[i]();
        i += 1;
        setTimeout(tick, 320);
      }
    };
    tick();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ----------------------------------------------------------------- state
  function setBusy(busy) {
    awaiting = busy;
    input.disabled = busy;
    sendBtn.disabled = busy;
    if (!busy) input.focus();
  }

  // ------------------------------------------------------------- websocket
  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "thinking") {
        showTyping();
      } else if (msg.type === "brain") {
        renderBrain(msg);
        if (msg.embed_dim) dimBadge.textContent = `embed dim ${msg.embed_dim}`;
        if (msg.source) srcBadge.textContent = `LLM ${msg.source}`;
      } else if (msg.type === "reply") {
        hideTyping();
        addMessage("agent", msg.text || "");
        setBusy(false);
      }
    };

    ws.onclose = () => {
      // try to reconnect quietly
      setTimeout(connect, 1500);
    };
  }

  // ------------------------------------------------------------------ send
  function send(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN || awaiting) return;
    setBusy(true);
    addMessage("user", text);
    startTurnBlock(text);
    ws.send(JSON.stringify({ type: "turn", user_id: USER_ID, text }));
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || awaiting) return;
    input.value = "";
    send(text);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // ------------------------------------------------------------------ init
  async function init() {
    let company = "Northwind";
    try {
      const res = await fetch("/api/info");
      const info = await res.json();
      company = info.company || "Northwind";
      document.title = `${company} — Customer Support`;
      brandTitle.textContent = `${company} Support`;
      brandAvatar.textContent = "🎧";
      if (info.embed_dim) dimBadge.textContent = `embed dim ${info.embed_dim}`;
      if (info.source) srcBadge.textContent = `LLM ${info.source}`;
    } catch {
      /* leave defaults */
    }

    connect();

    // a warm, branded greeting from the agent (not a real turn — no memory write)
    setTimeout(() => {
      addMessage(
        "agent",
        `Hi! 👋 You're chatting with ${company} Support. How can I help you today?`
      );
    }, 400);

    input.focus();
  }

  init();
})();
