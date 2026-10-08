import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatPage } from './ChatPage.tsx';
import { ImproverPage } from './ImproverPage.tsx';
import { navigate, useRoute } from './router.ts';
import './styles.css';

function App() {
	const route = useRoute();
	// Remember the last URL of each tab so switching tabs returns to the same session.
	const last = useRef({ chat: '/chat', improve: '/improve' });
	useEffect(() => {
		last.current[route.page] = window.location.pathname;
	}, [route]);

	return (
		<>
			<header className="topbar">
				<span className="brand">Chatbot Improvement</span>
				<nav>
					{(['chat', 'improve'] as const).map((page) => (
						<a
							key={page}
							href={last.current[page]}
							className={route.page === page ? 'active' : ''}
							onClick={(e) => {
								e.preventDefault();
								navigate(last.current[page]);
							}}
						>
							{page === 'chat' ? 'Chat' : 'Improver'}
						</a>
					))}
				</nav>
			</header>
			{route.page === 'chat' ? (
				<ChatPage sessionId={route.id} />
			) : (
				<ImproverPage sessionId={route.id} draft={route.draft} />
			)}
		</>
	);
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
