export default function Spinner({ small = false }) {
  return <div className={`spinner ${small ? 'spinner-sm' : ''}`} role="status" aria-label="Loading"><span /></div>;
}
