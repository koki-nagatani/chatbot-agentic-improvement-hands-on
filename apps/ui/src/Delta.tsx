export function Delta({ before, after }: { before: number | null; after: number | null }) {
	if (before == null || after == null || before === after) return null;
	return <span className={after > before ? 'pass' : 'fail'}>{after > before ? ' ↑' : ' ↓'}</span>;
}
