import { redirect } from '@sveltejs/kit';

// `/review` is the app: Redline opens straight onto the diff review screen, and picking a
// Repo happens in its topbar rather than on a landing page of its own.
export function load() {
  redirect(307, '/review');
}
