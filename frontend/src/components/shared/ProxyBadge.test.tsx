// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProxyBadge } from './ProxyBadge';

describe('ProxyBadge', () => {
  it('renders a chip with an accessible name for a proxy card', () => {
    const { container } = render(<ProxyBadge card={{ proxy: true }} />);
    const el = container.querySelector('[role="img"]');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('aria-label')).toBe('Proxy');
    expect(el!.className).toContain('proxy-badge');
  });

  it('renders nothing for a non-proxy card', () => {
    const { container } = render(<ProxyBadge card={{ proxy: false }} />);
    expect(container.querySelector('[role="img"]')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when proxy is undefined', () => {
    const { container } = render(<ProxyBadge card={{}} />);
    expect(container.querySelector('[role="img"]')).toBeNull();
  });
});
