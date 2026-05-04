export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl items-center justify-center px-6 py-16">
      <section className="glass-panel w-full p-10 text-center sm:p-14">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-[var(--brand)]">Hotel4U</p>
        <h1 className="mb-4 text-4xl font-bold text-[var(--ink)] sm:text-5xl">ברוכים הבאים</h1>
        <p className="mx-auto max-w-2xl text-base leading-8 text-[var(--muted)] sm:text-lg">
          זהו דף בית פשוט ונקי. כל שאר המודולים והעמודים הוסרו מהניווט ומהגישה באתר.
        </p>
      </section>
    </div>
  );
}
