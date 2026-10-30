/**
 * Placeholder de pantalla (F1). Cada pantalla real (S1–S10) lo reemplaza
 * en su fase; el título es el nombre de la pantalla según SCREENS_SPEC.
 */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <main>
      <h1>{title}</h1>
      <p>Esta pantalla se implementa en su fase correspondiente.</p>
    </main>
  );
}
