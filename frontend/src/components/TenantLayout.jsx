import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

/**
 * TenantLayout — App shell wrapper for tenant-scoped pages.
 * Renders the Sidebar + main content area using React Router's <Outlet>.
 */
export const TenantLayout = () => {
  return (
    <div className="app-container">
      <Sidebar />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
};

export default TenantLayout;
