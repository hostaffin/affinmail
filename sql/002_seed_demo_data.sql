-- AffinMail Seed Data
-- Migration: 002_seed_demo_data.sql

-- 1. Insert IP Pools
INSERT INTO ip_pools (id, ip_address, ip_version, pool_type, rdns_hostname, is_active, current_allocations, max_allocations, reputation_score)
VALUES 
    ('11111111-1111-1111-1111-111111111111', '195.201.10.101', 4, 'shared', 'mail-shared1.hostaffin.com', true, 1, 100, 10.0),
    ('22222222-2222-2222-2222-222222222222', '195.201.10.102', 4, 'dedicated', 'mail-dedicated1.hostaffin.com', true, 1, 1, 10.0)
ON CONFLICT (id) DO NOTHING;

-- 2. Insert Domains
INSERT INTO domains (id, domain_name, hostaffin_service_id, assigned_ip_id, is_dedicated_ip, max_mailboxes, max_attachment_size_mb, disk_quota_mb, dkim_selector, dkim_private_key, dkim_public_key, is_active)
VALUES 
    (
        '33333333-3333-3333-3333-333333333333', 
        'apexlogistics.com', 
        1001, 
        '22222222-2222-2222-2222-222222222222', 
        true, 
        10, 
        25, 
        20480, 
        'affinmail', 
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----', 
        'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0...', 
        true
    ),
    (
        '44444444-4444-4444-4444-444444444444', 
        'trendmart.com', 
        1002, 
        '11111111-1111-1111-1111-111111111111', 
        false, 
        5, 
        15, 
        10240, 
        'affinmail', 
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1...\n-----END RSA PRIVATE KEY-----', 
        'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1...', 
        true
    )
ON CONFLICT (id) DO NOTHING;

-- 3. Insert Mailboxes
INSERT INTO mailboxes (id, domain_id, email, username, password_hash, display_name, quota_limit_mb, quota_used_bytes, hourly_rate_limit, outbound_route, status, is_admin)
VALUES 
    (
        '55555555-5555-5555-5555-555555555555',
        '33333333-3333-3333-3333-333333333333',
        'marcus@apexlogistics.com',
        'marcus',
        '$argon2id$v=19$m=65536,t=3,p=4$demo_salt_hash',
        'Marcus Vance',
        10240,
        3435973836, -- ~3.2 GB
        200,
        'direct',
        'active',
        true
    ),
    (
        '66666666-6666-6666-6666-666666666666',
        '44444444-4444-4444-4444-444444444444',
        'elena@trendmart.com',
        'elena',
        '$argon2id$v=19$m=65536,t=3,p=4$demo_salt_hash2',
        'Elena Rostova',
        5120,
        1073741824, -- 1 GB
        150,
        'relay_ses',
        'active',
        true
    )
ON CONFLICT (id) DO NOTHING;

-- 4. Insert Warmup Schedule for Dedicated IP
INSERT INTO ip_warmup_schedules (id, domain_id, ip_id, current_stage_day, max_daily_limit, sent_today_count, last_reset_date, is_completed)
VALUES (
    '77777777-7777-7777-7777-777777777777',
    '33333333-3333-3333-3333-333333333333',
    '22222222-2222-2222-2222-222222222222',
    5,
    150,
    32,
    CURRENT_DATE,
    false
) ON CONFLICT (domain_id, ip_id) DO NOTHING;

-- 5. Insert Threads for marcus@apexlogistics.com
INSERT INTO email_threads (id, mailbox_id, subject, snippet, message_count, has_attachments, is_starred, is_unread, latest_received_at)
VALUES 
    (
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '55555555-5555-5555-5555-555555555555',
        'Payment Receipt #AF-1092 - AffinMail Hosting Plan',
        'Your payment of $45.00 for the AffinMail Enterprise Plan was received successfully.',
        1,
        true,
        true,
        true,
        NOW() - INTERVAL '15 minutes'
    ),
    (
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        '55555555-5555-5555-5555-555555555555',
        '[Security Alert] New SSH key registered to hostaffin-prod',
        'A new public key was added to your cluster infrastructure by marcus@apexlogistics.com.',
        1,
        false,
        false,
        true,
        NOW() - INTERVAL '1 hour'
    ),
    (
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        '55555555-5555-5555-5555-555555555555',
        'AffinMail Final Design Handover & Release Docs',
        'Hi Marcus, attached is the release documentation and design mockups for the Q4 rollout.',
        3,
        true,
        true,
        false,
        NOW() - INTERVAL '1 day'
    ),
    (
        'dddddddd-dddd-dddd-dddd-dddddddddddd',
        '55555555-5555-5555-5555-555555555555',
        'Hetzner Cloud: Monthly Statement for Account #H-90128',
        'Your monthly invoice for November 2026 is ready for download. Total balance: €14.28.',
        1,
        true,
        false,
        false,
        NOW() - INTERVAL '2 days'
    )
ON CONFLICT (id) DO NOTHING;

-- 6. Insert Messages
INSERT INTO email_messages (id, thread_id, mailbox_id, rfc_message_id, sender_name, sender_email, recipient_to, subject, snippet, size_bytes, blob_id, is_read, is_starred, labels, received_at)
VALUES 
    (
        uuid_generate_v4(),
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '55555555-5555-5555-5555-555555555555',
        '<invoice-af-1092@stripe.com>',
        'Stripe Billing',
        'billing@stripe.com',
        ARRAY['marcus@apexlogistics.com'],
        'Payment Receipt #AF-1092 - AffinMail Hosting Plan',
        'Your payment of $45.00 for the AffinMail Enterprise Plan was received successfully.',
        245000,
        'blob_stripe_inv_1092',
        false,
        true,
        ARRAY['inbox', 'billing'],
        NOW() - INTERVAL '15 minutes'
    ),
    (
        uuid_generate_v4(),
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        '55555555-5555-5555-5555-555555555555',
        '<alert-ssh-2918@github.com>',
        'GitHub Security',
        'security@github.com',
        ARRAY['marcus@apexlogistics.com'],
        '[Security Alert] New SSH key registered to hostaffin-prod',
        'A new public key was added to your cluster infrastructure by marcus@apexlogistics.com.',
        18000,
        'blob_github_alert_2918',
        false,
        false,
        ARRAY['inbox', 'security'],
        NOW() - INTERVAL '1 hour'
    ),
    (
        uuid_generate_v4(),
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        '55555555-5555-5555-5555-555555555555',
        '<handover-03@sarahchen.design>',
        'Sarah Chen',
        'sarah@chen.design',
        ARRAY['marcus@apexlogistics.com'],
        'AffinMail Final Design Handover & Release Docs',
        'Hi Marcus, attached is the release documentation and design mockups for the Q4 rollout.',
        14500000,
        'blob_sarah_handover_final',
        true,
        true,
        ARRAY['inbox', 'operations'],
        NOW() - INTERVAL '1 day'
    ),
    (
        uuid_generate_v4(),
        'dddddddd-dddd-dddd-dddd-dddddddddddd',
        '55555555-5555-5555-5555-555555555555',
        '<invoice-nov26@hetzner.com>',
        'Hetzner Cloud',
        'support@hetzner.com',
        ARRAY['marcus@apexlogistics.com'],
        'Hetzner Cloud: Monthly Statement for Account #H-90128',
        'Your monthly invoice for November 2026 is ready for download. Total balance: €14.28.',
        89000,
        'blob_hetzner_statement_nov',
        true,
        false,
        ARRAY['inbox', 'billing'],
        NOW() - INTERVAL '2 days'
    );
