import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export const ThemeToggle = ({ className, style }) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className={`btn btn-secondary ${className || ''}`}
      style={{
        padding: '0.5rem',
        borderRadius: '8px',
        minWidth: '36px',
        height: '36px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-active)',
        border: '1px solid var(--border-color)',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        ...style
      }}
      title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
};

export default ThemeToggle;
