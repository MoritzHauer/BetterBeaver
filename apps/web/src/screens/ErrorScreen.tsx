/** Developer-facing screen shown when bundled content fails validation at startup. */
export function ErrorScreen({ errors }: { errors: string[] }) {
  return (
    <main>
      <h1>Content validation failed</h1>
      <ul>
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </main>
  );
}
