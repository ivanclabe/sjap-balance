import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Sparkles, Trash2, Maximize2, Minimize2 } from 'lucide-react';
import { supabase } from '../supabase/client.js';

const SUGERENCIAS = [
  '¿Cuál fue la venta total de este mes?',
  '¿Cómo va el cierre de hoy?',
  '¿Qué producto tuvo más fluctuación este mes?',
];

export default function ChatAsistente({ estacionId }) {
  const [abierto, setAbierto] = useState(false);
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  const [mensajes, setMensajes] = useState([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mensajes, enviando]);

  async function enviar(mensaje) {
    const texto_limpio = mensaje.trim();
    if (!texto_limpio || enviando || !estacionId) return;

    const historial = mensajes
      .filter((m) => m.rol !== 'error')
      .map((m) => ({ role: m.rol, texto: m.texto }));

    setMensajes((prev) => [...prev, { rol: 'user', texto: texto_limpio }]);
    setTexto('');
    setEnviando(true);

    try {
      const { data, error } = await supabase.functions.invoke('chat-asistente', {
        body: { estacionId, mensaje: texto_limpio, historial },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'El asistente no pudo responder.');
      setMensajes((prev) => [...prev, { rol: 'assistant', texto: data.respuesta }]);
    } catch (err) {
      setMensajes((prev) => [...prev, { rol: 'error', texto: err.message || 'Error al contactar al asistente.' }]);
    } finally {
      setEnviando(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    enviar(texto);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviar(texto);
    }
  }

  function limpiarChat() {
    if (enviando) return;
    setMensajes([]);
  }

  function cerrarPanel() {
    setAbierto(false);
    setPantallaCompleta(false);
  }

  return (
    <>
      {abierto && (
        <div className={`chat-panel${pantallaCompleta ? ' chat-panel--full' : ''}`}>
          <div className="chat-panel__header">
            <div className="chat-panel__header-icon">
              <Sparkles size={16} />
            </div>
            <div className="chat-panel__header-text">
              <div className="chat-panel__title">Asistente SJAP</div>
              <div className="chat-panel__subtitle">Pregunta sobre cierres y balance mensual</div>
            </div>
            <div className="chat-panel__header-actions">
              <button
                className="chat-panel__icon-btn"
                onClick={limpiarChat}
                disabled={enviando || mensajes.length === 0}
                aria-label="Limpiar chat"
                title="Limpiar chat"
              >
                <Trash2 size={16} />
              </button>
              <button
                className="chat-panel__icon-btn"
                onClick={() => setPantallaCompleta((v) => !v)}
                aria-label={pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
                title={pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
              >
                {pantallaCompleta ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button className="chat-panel__icon-btn" onClick={cerrarPanel} aria-label="Cerrar" title="Cerrar">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="chat-msgs" ref={scrollRef}>
            {mensajes.length === 0 && (
              <div className="chat-empty">
                Puedo consultar los cierres diarios y el balance mensual por ti — cifras, rankings, fluctuaciones y
                más. Todo lo que responda viene directo de la base de datos.
                <div className="chat-empty__suggestions">
                  {SUGERENCIAS.map((s) => (
                    <button key={s} className="chat-suggestion" onClick={() => enviar(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mensajes.map((m, i) => (
              <div key={i} className={`chat-msg chat-msg--${m.rol === 'user' ? 'user' : m.rol === 'error' ? 'assistant chat-msg--error' : 'assistant'}`}>
                {m.texto}
              </div>
            ))}

            {enviando && (
              <div className="chat-typing">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>

          <form className="chat-input-row" onSubmit={onSubmit}>
            <textarea
              className="chat-input"
              rows={1}
              placeholder="Escribe tu pregunta…"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={enviando}
            />
            <button className="chat-send" type="submit" disabled={enviando || !texto.trim()} aria-label="Enviar">
              <Send size={16} />
            </button>
          </form>
        </div>
      )}

      <button
        className="chat-fab"
        onClick={() => (abierto ? cerrarPanel() : setAbierto(true))}
        aria-label="Abrir asistente"
      >
        {abierto ? <X /> : <MessageCircle />}
      </button>
    </>
  );
}
