-- =========================================================
-- 001. Wishlist shared status table + atomic RPC.
--     Public GitHub Pages (anon key) → RLS policies open.
-- =========================================================

-- 1. Table: current status of each gift (1 row per card id)
CREATE TABLE IF NOT EXISTS public.wishlist_status (
    item_id      TEXT PRIMARY KEY,
    total_qty    INT  NOT NULL DEFAULT 1,    -- copy of WISHLIST[i].total_qty (-1 = infinite)
    taken_qty    INT  NOT NULL DEFAULT 0 CHECK (taken_qty >= 0),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Seed: 9 cards defined in wishlist.html WISHLIST[]
INSERT INTO public.wishlist_status (item_id, total_qty, taken_qty) VALUES
    ('korzina',  2,  0),
    ('massage',  1,  0),
    ('print',    8,  0),
    ('yoga',     -1, 0),
    ('bread',    4,  0),
    ('rehab',    4,  0),
    ('psy',      4,  0),
    ('tattoo',   1,  0),
    ('sneakers', -1, 0)
ON CONFLICT (item_id) DO NOTHING;

-- 3. Row Level Security
ALTER TABLE public.wishlist_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wishlist_status_read_all"  ON public.wishlist_status;
DROP POLICY IF EXISTS "wishlist_status_write_all" ON public.wishlist_status;

CREATE POLICY "wishlist_status_read_all"
    ON public.wishlist_status FOR SELECT
    USING (true);

CREATE POLICY "wishlist_status_write_all"
    ON public.wishlist_status FOR INSERT
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.wishlist_status TO anon, authenticated, service_role;

-- 4. Atomic RPC: increment_taken(item_id, qty) — race-condition safe.
--    Returns the new row state as json (so JS knows success/taken_qty).
CREATE OR REPLACE FUNCTION public.increment_wishlist_taken(p_item_id TEXT, p_qty INT DEFAULT 1)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total INT;
    v_old   INT;
    v_new   INT;
    v_give  INT;
    v_row   wishlist_status%ROWTYPE;
BEGIN
    SELECT * INTO v_row FROM wishlist_status WHERE item_id = p_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'unknown_item'
        );
    END IF;

    v_total := v_row.total_qty;
    v_old   := v_row.taken_qty;

    -- Cap how many we can take in this call (1 call = 1 "беру")
    IF v_total = -1 THEN
        v_give := p_qty;                -- infinite (yoga / sneakers piggy)
    ELSE
        v_give := LEAST(p_qty, GREATEST(v_total - v_old, 0));
    END IF;

    IF v_give <= 0 THEN
        RETURN jsonb_build_object(
            'success',   false,
            'message',   'already_taken',
            'taken_qty', v_old,
            'total_qty', v_total,
            'given_qty', 0
        );
    END IF;

    v_new := v_old + v_give;

    UPDATE wishlist_status
       SET taken_qty  = v_new,
           updated_at = NOW()
     WHERE item_id  = p_item_id;

    RETURN jsonb_build_object(
        'success',   true,
        'taken_qty', v_new,
        'total_qty', v_total,
        'given_qty', v_give,
        'item_id',   p_item_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_wishlist_taken TO anon, authenticated, service_role;
