window.HubClient = function HubClient({ url, onMessage, onOpen, onStatus }) {
  let ws = null;
  let delay = 500;
  let latestUnsent = null;

  function connect() {
    try { ws = new WebSocket(url); } catch (e) { retry(); return; }
    ws.onopen = () => {
      delay = 500;
      onStatus && onStatus(true);
      onOpen && onOpen();
      if (latestUnsent) { ws.send(latestUnsent); latestUnsent = null; }
    };
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onclose = () => { onStatus && onStatus(false); retry(); };
    ws.onerror = () => ws.close();
  }

  function retry() {
    setTimeout(connect, delay);
    delay = Math.min(delay * 2, 5000);
  }

  connect();

  return {
    send(msg) {
      const data = JSON.stringify(msg);
      if (ws && ws.readyState === 1) ws.send(data); else latestUnsent = data;
    },
  };
};
