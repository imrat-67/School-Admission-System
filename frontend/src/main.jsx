import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// last safety net: an unexpected UI error must never leave a blank page
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.error(err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ maxWidth: 520, margin: '80px auto', padding: 24, textAlign: 'center', fontFamily: 'sans-serif' }}>
        <h2>দুঃখিত, পেজটি দেখাতে সমস্যা হয়েছে</h2>
        <p>অনুগ্রহ করে পেজটি রিফ্রেশ করুন। আপনার আবেদনগুলো নিরাপদ আছে।</p>
        <button onClick={() => window.location.reload()} style={{ padding: '10px 18px', fontSize: 16 }}>রিফ্রেশ করুন</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
