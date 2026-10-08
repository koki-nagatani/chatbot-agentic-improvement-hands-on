import { useEffect, useState } from 'react';
import {
	api,
	type Comparison,
	type EvalListItem,
	type EvalResult,
	metricLabel,
	pct,
	usd,
} from './api.ts';
import { Delta } from './Delta.tsx';

/** Eval results saved under evals/results/: list, detail, and comparison with another run. */
export function EvalPanel({
	selected,
	onSelect,
	refreshKey,
}: {
	selected?: string;
	onSelect: (runId?: string) => void;
	refreshKey: string;
}) {
	const [runs, setRuns] = useState<EvalListItem[]>([]);

	useEffect(() => {
		api
			.evals()
			.then((list) => setRuns(list.reverse()))
			.catch(() => {});
	}, [refreshKey]);

	return (
		<aside className="eval-panel">
			{selected ? (
				<EvalDetail runId={selected} runs={runs} onBack={() => onSelect(undefined)} />
			) : (
				<>
					<h3>Eval結果</h3>
					<ul className="run-list">
						{runs.map((r) => (
							<li key={r.run_id}>
								<button type="button" onClick={() => onSelect(r.run_id)}>
									<span className="score">{pct(r.overall.rate)}</span>
									<span className="mono">{r.run_id}</span>
									<span className="muted">
										{r.overall.passed}/{r.overall.total}
										{r.cost && ` · ${usd(r.cost.total_usd)}`}
									</span>
								</button>
							</li>
						))}
						{runs.length === 0 && <li className="muted">まだEval結果がありません</li>}
					</ul>
				</>
			)}
		</aside>
	);
}

function EvalDetail({
	runId,
	runs,
	onBack,
}: {
	runId: string;
	runs: EvalListItem[];
	onBack: () => void;
}) {
	const [result, setResult] = useState<EvalResult>();
	const [baseId, setBaseId] = useState<string>('');
	const [comparison, setComparison] = useState<Comparison>();

	useEffect(() => {
		setResult(undefined);
		api.evalResult(runId).then(setResult).catch(() => {});
	}, [runId]);

	useEffect(() => {
		setComparison(undefined);
		if (baseId) api.compare(baseId, runId).then(setComparison).catch(() => {});
	}, [baseId, runId]);

	if (!result) return <p className="muted">読み込み中…</p>;

	const rows =
		comparison?.rows ??
		Object.entries(result.summary)
			.sort(([a], [b]) => (a === 'overall' ? -1 : b === 'overall' ? 1 : a.localeCompare(b)))
			.map(([key, s]) => ({ key, before: null, after: s.rate }));
	const changes = new Map(comparison?.changes.map((c) => [c.id, c]));

	return (
		<div className="eval-detail">
			<button type="button" className="link" onClick={onBack}>
				← 一覧に戻る
			</button>
			<h3 className="mono">{result.run_id}</h3>
			{result.cost && (
				<p className="cost">
					コスト {usd(result.cost.total_usd)}
					<span className="muted">
						{' '}
						（Bot {usd(result.cost.bot_usd)} + Judge {usd(result.cost.judge_usd)}）
					</span>
				</p>
			)}

			<label className="compare-select">
				比較対象（Before）
				<select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
					<option value="">なし</option>
					{runs
						.filter((r) => r.run_id !== runId)
						.map((r) => (
							<option key={r.run_id} value={r.run_id}>
								{r.run_id} ({pct(r.overall.rate)})
							</option>
						))}
				</select>
			</label>

			<table className="summary">
				<thead>
					<tr>
						<th />
						{comparison && <th>Before</th>}
						<th>{comparison ? 'After' : 'Pass rate'}</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr key={r.key} className={r.key === 'overall' ? 'overall' : ''}>
							<td>{metricLabel(r.key)}</td>
							{comparison && <td>{pct(r.before)}</td>}
							<td>
								{pct(r.after)}
								{comparison && <Delta before={r.before} after={r.after} />}
							</td>
						</tr>
					))}
				</tbody>
			</table>

			<h4>ケース</h4>
			<ul className="case-list">
				{result.cases.map((c) => {
					const passed = c.runs.filter((r) => r.pass).length;
					const ok = passed === c.runs.length;
					const run = c.runs.find((r) => !r.pass) ?? c.runs[0];
					const change = changes.get(c.id);
					return (
						<li key={c.id}>
							<details>
								<summary>
									<span className={ok ? 'pass' : 'fail'}>{ok ? 'PASS' : 'FAIL'}</span>{' '}
									<span className="mono">{c.id}</span>
									{c.runs.length > 1 && (
										<span className="muted">
											{' '}
											({passed}/{c.runs.length})
										</span>
									)}
									{change && (
										<span className="muted">
											{' '}
											{change.before} → {change.after}
										</span>
									)}
								</summary>
								<div className="case-body">
									{run.history.length > 0 && (
										<p className="muted">会話履歴 {run.history.length / 2} 往復の後の質問:</p>
									)}
									<p>
										<strong>Q.</strong> {run.question}
									</p>
									<p className="answer">
										<strong>A.</strong> {run.answer}
									</p>
									<p className="muted mono">検索: {run.search_query}</p>
									<p className="muted mono">取得: {run.retrieved.join(', ')}</p>
									<ul className="verdicts">
										{run.checks.map((ch, i) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: static list
											<li key={i} className={ch.pass ? 'pass' : 'fail'}>
												{ch.pass ? '✓' : '✗'} {ch.check}: {JSON.stringify(ch.target)}
												{ch.matched && ` (一致: ${ch.matched})`}
											</li>
										))}
										{run.judge.map((j) => (
											<li key={j.criterion} className={j.pass ? 'pass' : 'fail'}>
												{j.pass ? '✓' : '✗'} {j.criterion}
												{!j.pass && <div className="reason">{j.reason}</div>}
											</li>
										))}
									</ul>
								</div>
							</details>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
