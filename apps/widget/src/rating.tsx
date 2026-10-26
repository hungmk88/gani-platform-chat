// The rating after the chat (W3, Phụ lục C dòng 10): 1 to 5 stars as radio buttons (a screen reader reads "3 sao"), a remark if the
// customer wants, or "Bỏ qua". Either way the chat then ends and is wiped from this device.
import { useEffect, useRef, useState } from 'preact/hooks';

import { MAX_REMARK, type Rating } from './chat';

const STARS = [1, 2, 3, 4, 5] as const;

export function RatingForm({ onDone }: { onDone: (rating: Rating | null) => void }) {
  const [stars, setStars] = useState<Rating['stars'] | null>(null);
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const done = (rating: Rating | null) => {
    if (busy) return;
    setBusy(true);
    onDone(rating);
  };
  return (
    <form
      class="rating"
      onSubmit={(e) => {
        e.preventDefault();
        if (stars) done({ stars, remark: remark.trim() });
      }}
    >
      <fieldset>
        <legend>Bạn thấy cuộc trò chuyện thế nào?</legend>
        <div class="stars">
          {STARS.map((n) => (
            <label key={n} class={stars !== null && n <= stars ? 'star on' : 'star'}>
              <input
                {...(n === 1 ? { ref: first } : {})}
                type="radio"
                name="gani-stars"
                value={n}
                checked={stars === n}
                onChange={() => setStars(n)}
              />
              <span aria-hidden="true">★</span>
              <span class="sr-only">{n} sao</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        Góp ý (không bắt buộc)
        <textarea
          rows={3}
          value={remark}
          maxLength={MAX_REMARK}
          onInput={(e) => setRemark(e.currentTarget.value)}
        />
      </label>
      <div class="actions">
        <button type="submit" class="primary" disabled={!stars || busy} aria-busy={busy}>
          Gửi đánh giá
        </button>
        <button type="button" class="link" disabled={busy} onClick={() => done(null)}>
          Bỏ qua
        </button>
      </div>
    </form>
  );
}
