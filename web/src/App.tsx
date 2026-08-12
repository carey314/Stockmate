import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './auth'
import AdminLayout from './layout/AdminLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import TodoPage from './pages/TodoPage'
import ProductsPage from './pages/ProductsPage'
import TypesPage from './pages/TypesPage'
import PartnersPage from './pages/PartnersPage'
import OrdersPage from './pages/OrdersPage'
import PurchasePage from './pages/PurchasePage'
import StocktakePage from './pages/StocktakePage'
import LedgerPage from './pages/LedgerPage'
import QuickEntryPage from './pages/QuickEntryPage'
import ReportsPage from './pages/ReportsPage'
import CalendarPage from './pages/CalendarPage'
import StatementsPage from './pages/StatementsPage'
import ImportPage from './pages/ImportPage'
import SettingsPage from './pages/SettingsPage'

// 报表大屏对 staff 开放（与 App 报表中心一致），页内按卡片级隐藏利润/资金流水/员工业绩；
// 设置页同理：员工只看到"修改我的密码"。
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="todo" element={<TodoPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="types" element={<TypesPage />} />
        <Route path="partners" element={<PartnersPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="purchase" element={<PurchasePage />} />
        <Route path="stocktake" element={<StocktakePage />} />
        <Route path="ledger" element={<LedgerPage />} />
        <Route path="quick-entry" element={<QuickEntryPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="statements" element={<StatementsPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
