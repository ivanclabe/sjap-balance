import InfoTip from './InfoTip.jsx';

export default function KpiCard({ label, value, sublabel, tone, info, onClick }) {
  const toneClass = tone ? `kpi-card--${tone}` : '';
  return (
    <div
      className={`kpi-card ${toneClass} ${onClick ? 'kpi-card--clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
    >
      <div className="kpi-card__label">
        {label}
        {info && <InfoTip side="left">{info}</InfoTip>}
      </div>
      <div className="kpi-card__value">{value}</div>
      {sublabel && <div className="kpi-card__sublabel">{sublabel}</div>}
    </div>
  );
}
