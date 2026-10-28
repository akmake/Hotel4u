import DashboardPage from './DashboardPage';
import './TodayPage.css';

// "היום בקבלה" in the approved look (2026-10-28): glass summary cards, guest rows as cards under
// one header, one split action per row, soft room cards, grey canvas, Material 3 buttons.
// Styles: TodayPage.css. Navigation style stays per user.
export default function TodayPage() {
  return (
    <div className="today-page" dir="rtl">
      <DashboardPage summaryAppearance="glass" rowAppearance="table" assignAppearance="today" checkinAppearance="accordion" />
    </div>
  );
}
