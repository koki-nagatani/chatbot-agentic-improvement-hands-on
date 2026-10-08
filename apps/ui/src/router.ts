import { useEffect, useState } from 'react';

export type Route =
	| { page: 'chat'; id?: string }
	| { page: 'improve'; id?: string; draft?: string };

export function parseRoute(location: Location): Route {
	const [, page, id] = location.pathname.split('/');
	if (page === 'improve') {
		const draft = new URLSearchParams(location.search).get('draft') ?? undefined;
		return { page, id: id || undefined, draft };
	}
	return { page: 'chat', id: page === 'chat' ? id || undefined : undefined };
}

export function navigate(path: string, { replace = false } = {}) {
	if (replace) history.replaceState(null, '', path);
	else history.pushState(null, '', path);
	window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
	const [route, setRoute] = useState(() => parseRoute(window.location));
	useEffect(() => {
		const onChange = () => setRoute(parseRoute(window.location));
		window.addEventListener('popstate', onChange);
		return () => window.removeEventListener('popstate', onChange);
	}, []);
	return route;
}

export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
