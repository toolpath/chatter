import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testMachine } from '../../test/testMachine';
import { Sidebar } from './Sidebar';

const machines = [testMachine({ id: 'a', name: 'Lathe' }), testMachine({ id: 'b', name: 'Mill' })];

/** Tailwind's `md:` width is the line between a narrow and a wide screen */
function setScreen(width: 'narrow' | 'wide') {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: width === 'wide', media: query }));
}

function renderSidebar(path = '/') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar machines={machines} />
    </MemoryRouter>,
  );
}

const listToggle = () => screen.getByRole('button', { name: 'Machine list' });
/** The "Machines" item at the top of the menu. Its name also has the machine count. */
const machinesLink = () => screen.getByRole('link', { name: /^Machines/ });
const machineLink = (name: string) => screen.queryByRole('link', { name: new RegExp(name) });

describe('Sidebar machine list', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is open on a wide screen, and stays open after a machine is picked', () => {
    setScreen('wide');
    renderSidebar();
    expect(listToggle()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(machineLink('Lathe')!);
    expect(machineLink('Mill')).toBeInTheDocument();
  });

  it('is closed on a narrow screen until the arrow opens it', () => {
    setScreen('narrow');
    renderSidebar();
    expect(listToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(machineLink('Lathe')).not.toBeInTheDocument();

    fireEvent.click(listToggle());
    expect(machineLink('Lathe')).toBeInTheDocument();
  });

  it('opens on a wide screen when the user goes to the machines', () => {
    setScreen('wide');
    renderSidebar();
    fireEvent.click(listToggle());
    expect(listToggle()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(machinesLink());
    expect(listToggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes on a narrow screen when the user goes to the machines', () => {
    setScreen('narrow');
    renderSidebar();
    fireEvent.click(listToggle());

    fireEvent.click(machinesLink());
    expect(listToggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on a narrow screen after a machine is picked', () => {
    setScreen('narrow');
    renderSidebar();
    fireEvent.click(listToggle());

    fireEvent.click(machineLink('Lathe')!);
    expect(listToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(machineLink('Mill')).not.toBeInTheDocument();
  });
});

describe('Sidebar settings gear', () => {
  beforeEach(() => {
    setScreen('wide');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the settings, and there is no log out button in the menu', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
  });

  it('is the current page on the settings page', () => {
    renderSidebar('/settings');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });
});
