import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { wouldExceed } from '@/lib/plans'
import { BatchForm } from './batch-form'

export const metadata = { title: 'নতুন ব্যাচ — CoachDesk' }

export default async function NewBatchPage() {
  const session = await requireRole('manager')
  const supabase = await createClient()

  const [{ data: subjects }, { data: teachers }, { count: batchCount }] =
    await Promise.all([
      supabase
        .from('subjects')
        .select('id, name, name_bn')
        .eq('active', true)
        .order('name'),
      supabase
        .from('teachers')
        .select('id, name')
        .eq('active', true)
        .order('name'),
      supabase
        .from('batches')
        .select('id', { count: 'exact', head: true })
        .eq('active', true),
    ])

  // The action re-checks this; showing it here saves a teacher filling in a
  // long form only to be refused at the end.
  const atLimit = wouldExceed(session.plan, 'maxBatches', batchCount ?? 0)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings/batches"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← ব্যাচ
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">নতুন ব্যাচ</h1>
      </div>

      {atLimit ? (
        <Card>
          <p className="font-medium text-ink">এই প্ল্যানে আর ব্যাচ যোগ করা যাবে না</p>
          <p className="mt-1 text-sm text-ink-soft">
            {session.plan.nameBn} প্ল্যানে{' '}
            <span className="num">{session.plan.maxBatches}</span>টি ব্যাচ। হাজিরা,
            পরীক্ষা, SMS, ফি — সব ফিচার খোলা থাকে, শুধু ব্যাচের সংখ্যায় সীমা।
          </p>
        </Card>
      ) : (subjects ?? []).length === 0 ? (
        <Card>
          <p className="font-medium text-ink">আগে একটি বিষয় যোগ করুন</p>
          <p className="mt-1 text-sm text-ink-soft">
            ব্যাচ কোন বিষয়ের, সেটা ছাড়া নম্বর আর ফি ঠিক জায়গায় বসবে না।
          </p>
          <Link
            href="/settings/subjects"
            className="mt-4 inline-flex min-h-tap items-center justify-center
              rounded-xl bg-brand-600 px-5 font-semibold text-white"
          >
            বিষয় যোগ করুন
          </Link>
        </Card>
      ) : (
        <BatchForm
          subjects={(subjects ?? []).map((s) => ({
            id: s.id,
            label: s.name_bn || s.name,
          }))}
          teachers={(teachers ?? []).map((t) => ({ id: t.id, label: t.name }))}
        />
      )}
    </div>
  )
}
