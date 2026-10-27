const SORTS = [
  ['hot', 'Hot'],
  ['new', 'New'],
  ['active', 'Active'],
  ['top', 'Top'],
];
const WINDOWS = [['day', 'Today'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['all', 'All time']];

export default function SortBar({ sort, t, onChange }) {
  return (
    <div className="sortbar">
      <div className="segmented" role="tablist">
        {SORTS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={sort === k} className={sort === k ? 'on' : ''} onClick={() => onChange({ sort: k, t })}>
            {label}
          </button>
        ))}
      </div>
      {sort === 'top' && (
        <select value={t} onChange={(e) => onChange({ sort, t: e.target.value })} aria-label="Time range">
          {WINDOWS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      )}
    </div>
  );
}
