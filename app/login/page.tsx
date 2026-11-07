/**
 * useSearchParams() (used to read ?next= and ?denied=) requires a
 * Suspense boundary around it in the App Router, or static generation
 * fails at build time. The form itself is a client component below.
 */
import { Suspense } from 'react';
import LoginForm from './LoginForm';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
