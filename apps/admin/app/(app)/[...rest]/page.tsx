import { notFound } from 'next/navigation';

/** Any path of a signed-in person that no screen answers: the 404 inside the frame, so the menu stays. */
export default function Unknown() {
  notFound();
}
