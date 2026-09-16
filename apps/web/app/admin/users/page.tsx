import { prisma } from "@imap-ai/core/db";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/session";
import { setUserRole } from "./actions";
import { DeleteUserButton } from "./DeleteUserButton";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const admin = await requireAdmin();

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { emailAccounts: true } } },
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The first person to sign up became admin automatically. Admins can promote/demote other users and remove a
        user&apos;s locally-synced data -- the only authorization tier this app has.
      </p>

      <Table className="mt-6">
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Mailboxes</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const isSelf = user.id === admin.id;
            const toggleTo = user.role === "admin" ? "user" : "admin";
            return (
              <TableRow key={user.id}>
                <TableCell className="font-medium">
                  {user.email}
                  {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={user.role === "admin" ? "default" : "outline"} className="font-normal capitalize">
                    {user.role}
                  </Badge>
                </TableCell>
                <TableCell>{user._count.emailAccounts}</TableCell>
                <TableCell className="text-muted-foreground">{user.createdAt.toLocaleDateString("en-US")}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <form action={setUserRole.bind(null, user.id, toggleTo)}>
                      <Button type="submit" size="sm" variant="outline">
                        {toggleTo === "admin" ? "Make admin" : "Remove admin"}
                      </Button>
                    </form>
                    {!isSelf && <DeleteUserButton userId={user.id} email={user.email} />}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </main>
  );
}
