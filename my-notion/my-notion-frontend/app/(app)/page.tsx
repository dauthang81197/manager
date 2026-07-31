/**
 * Landing state for the (app) group's root ("/"). Without this file, "/"
 * had no page inside the (app) group at all, so a logged-in user with no
 * Page open — including right after the Sidebar's "active page vanished"
 * redirect to '/' — fell through to whatever resolved at the bare "/" route
 * outside this group (previously the untouched create-next-app boilerplate:
 * no auth, no sidebar, unrelated to this product). Adding this page makes
 * "/" resolve inside the (app) group instead, so it gets the auth check and
 * Sidebar from app/(app)/layout.tsx like every other route here.
 */
export default function WorkspaceHome() {
  return (
    <div className="p-8 text-zinc-500">
      Chọn hoặc tạo một Trang ở sidebar để bắt đầu.
    </div>
  );
}
