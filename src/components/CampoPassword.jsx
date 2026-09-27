import { useState } from 'react';
import { Eye, EyeOff, Check, X } from 'lucide-react';
import { REGLAS_PASSWORD } from '../lib/password.js';

// Campo de contraseña con botón mostrar/ocultar y aviso de Bloq Mayús.
export function CampoPassword({ id, label, value, onChange, autoComplete = 'current-password', autoFocus = false, placeholder }) {
  const [visible, setVisible] = useState(false);
  const [mayus, setMayus] = useState(false);
  const detectarMayus = (e) => setMayus(Boolean(e.getModifierState?.('CapsLock')));

  return (
    <div className="field-row">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="campo-password">
        <input
          id={id}
          name={id}
          className="field-input"
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={detectarMayus}
          onKeyDown={detectarMayus}
          onBlur={() => setMayus(false)}
          spellCheck={false}
        />
        <button
          type="button"
          className="campo-password__ver"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {mayus && <div className="campo-password__mayus">Bloq Mayús está activado.</div>}
    </div>
  );
}

// Lista de requisitos que se marca a medida que la persona escribe.
export function ReglasPassword({ password, username }) {
  return (
    <ul className="reglas-password" aria-label="Requisitos de la contraseña">
      {REGLAS_PASSWORD.map((r) => {
        const ok = r.cumple(password, username);
        return (
          <li key={r.id} className={ok ? 'reglas-password__ok' : ''}>
            {ok ? <Check size={12} /> : <X size={12} />} {r.texto}
          </li>
        );
      })}
    </ul>
  );
}
