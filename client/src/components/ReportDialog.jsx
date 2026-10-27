import { useEffect, useState } from 'react';
import { get, post } from '../api.js';
import { useToast } from '../toast.jsx';
import Modal from './Modal.jsx';

let cachedReasons = null;

export default function ReportDialog({ kind, id, onClose }) {
  const [reasons, setReasons] = useState(cachedReasons);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!cachedReasons) get('/reports/reasons').then((r) => { cachedReasons = r.reasons; setReasons(r.reasons); });
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/reports', { kind, id, reason, details });
      toast('Thanks — moderators will take a look.');
      onClose(true);
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Modal title={`Report ${kind}`} onClose={() => onClose(false)}>
      <form onSubmit={submit} className="stack">
        <div className="radio-list">
          {reasons && Object.entries(reasons).map(([k, label]) => (
            <label key={k} className={`radio ${reason === k ? 'on' : ''}`}>
              <input type="radio" name="reason" value={k} checked={reason === k} onChange={() => setReason(k)} />
              {label}
            </label>
          ))}
        </div>
        <textarea placeholder="Anything else moderators should know? (optional)" value={details} maxLength={500} onChange={(e) => setDetails(e.target.value)} rows={3} />
        {reason === 'self_harm' && (
          <p className="callout">If someone is in immediate danger, call 911. You can reach the 988 Suicide & Crisis Lifeline any time by calling or texting <strong>988</strong>.</p>
        )}
        <button className="btn btn-primary" disabled={!reason || busy}>Submit report</button>
      </form>
    </Modal>
  );
}
