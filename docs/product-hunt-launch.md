# BuzzRouter Product Hunt launch

Status: Draft ready for partner review. Product Hunt metadata, media, and launch readiness checks are still open.

Maker: John Lee (`johnlee3`)

Product: BuzzRouter

Pricing: Free

Primary Product Hunt URL: `https://buzzrouter.com/shared-channels`

## Paste-ready Product Hunt copy

### Tagline

> Connect independent Buzz communities

36 of 60 characters.

### Description

> BuzzRouter connects independent Buzz communities. Owners link one local channel, members send addressed messages to other communities, and anyone can find verified communities that are open to join.

198 of 260 characters.

### Maker's first comment

Hey Product Hunt, I'm John Lee, the maker of BuzzRouter.

BuzzRouter is an independent project. It is not affiliated with Block or the Buzz project.

I first heard about Buzz through the attention around Block's launch and Jack Dorsey. The free and open source part got me curious, but what kept me looking was the way Buzz lets people and multiple agents work together in one place. They can communicate directly and keep the context of a project in a persistent workspace. That felt like a missing piece in team-based agentic engineering.

Then I wanted to know what the other Buzz communities were building. Which ones were working on projects I would care about? Where could I join and contribute? I could not find an easy way to do that, and I knew I would not be the only person with that problem.

I think some of tomorrow's most interesting projects will be built inside these communities. But if every community stays isolated, people and their agents miss the chance to find one another, share their work, and collaborate.

That is why I built BuzzRouter.

BuzzRouter lets people find verified Buzz communities, understand what they are working on, and join the ones that are open. Community owners can submit their workspace for verification and connect one local channel. Once connected, members can address a message to another participating community.

Local conversation stays local. BuzzRouter only routes a message when someone addresses another community at the start of it, and the destination can see where the message came from.

BuzzRouter is early, and I want to learn from the people using Buzz now.

If you use Buzz, is the directory information enough to decide whether you want to join a community? If you run a community, what would you need to feel comfortable connecting one of your channels?

You can find a community or connect yours at https://buzzrouter.com.

## Gallery plan

Create three images at 1270 x 760. Use current production screens or a clearly labeled demo environment. Do not show invite links, keys, private channel history, or unrelated members.

### Frame 1: addressed messaging

Headline:

> Send a message to another Buzz community

Support:

> Start with `@community`. BuzzRouter delivers the message to that community and shows where it came from.

Capture the source and destination side by side. The source should show a message beginning with a real `@community` address. The destination should show the same message once, with its source attribution visible.

Do not use the current "Messages fan out" illustration or an unaddressed message example. They conflict with how routing works.

### Frame 2: discovery and joining

Headline:

> Find communities working on things you care about

Support:

> Search verified communities, understand what they do, and join the ones that are open.

Capture Discover with a real, verified, joinable community selected. Rehearse its join path on the same day. If no approved community is available, use a clearly labeled demo community.

### Frame 3: owner setup

Headline:

> Connect one local channel

Support:

> Use an owner or admin invite, choose a channel, and control which participating communities it can exchange messages with.

Capture the connected state after admission, with the selected local channel and active settings visible. Never show the pasted invite.

## Optional launch video

Record a 45 to 60 second video only after the connection, delivery, and join flows work cleanly twice in a row. Three strong gallery images are enough if the live demonstration is not dependable.

### Storyboard

1. Show two independent Buzz communities and explain that their messages normally stay local.
2. Show an owner connecting one local channel without showing the invite value.
3. Type an addressed message such as `@orange-magic Could you review this?`.
4. Show it arrive in the named destination with its source attribution.
5. Show Discover briefly and join a community with a rehearsed open path.
6. End with: `Find a community, or connect yours at buzzrouter.com.`

### Voiceover

I found Buzz through the attention around Block's launch. What kept me interested was the idea of people and multiple agents building together in one persistent workspace.

Then I got curious about what the other Buzz communities were making. I wanted to find the ones working on projects I cared about, but there was no easy way to see what each community did or how to join it.

So I built BuzzRouter.

BuzzRouter helps people find verified communities and join the ones that are open. Owners can also connect one local channel. Members address a message to a participating community, and BuzzRouter delivers it with the source clearly shown. Everything else stays local.

Find a community, or connect yours, at buzzrouter.com.

## Launch-day X post

> I built BuzzRouter because I wanted to know what other Buzz communities were working on and could not find an easy answer.
>
> Now you can find verified communities, join the ones that are open, and connect one channel so members can send addressed messages between communities.
>
> BuzzRouter is live on Product Hunt today. I would appreciate feedback from Buzz users and community owners: [PRODUCT HUNT URL]

## Product position and copy rules

Product Hunt should see BuzzRouter as a working connection product, with discovery as the way people enter the network. Product Hunt's current featuring guidelines say that directories and lists are not featured.

The launch serves two audiences:

1. Buzz users can find verified communities, understand what they do, and join the ones that are open.
2. Community owners can submit a workspace for verification and connect one local channel so members can send addressed messages to participating communities.

Keep every public claim within these boundaries:

- Routing is addressed, not broadcast. A message leaves its source community only when its first token names a destination such as `@community` or `@community/user`.
- Connecting a channel does not mirror every message to every participant. Unaddressed conversation stays local.
- The destination can see the source community and sender.
- "Verified" means BuzzRouter contacted the workspace and checked that it responds as expected. It is not an endorsement of the community or its moderation.
- Not every verified community is open to join.
- Submission starts a verification process. It is not instant publication.
- Information entered in the submission form does not currently become public listing copy automatically.
- BuzzRouter is independent and is not affiliated with Block or the Buzz project.
- Do not name or compare BuzzRouter with another directory in the launch campaign.
- Do not claim traction, quote unavailable X posts, ask for upvotes, expose invite capabilities, or describe planned behavior as shipped.

## Product Hunt metadata to finish

- Choose two or three topics that cover messaging, communities, and collaboration.
- Add Shoutouts only for products that materially helped build BuzzRouter.
- Add the Product Hunt launch URL to the X post after scheduling.
- Add a product X account if one exists, or omit it.
- Export a square BuzzRouter thumbnail at 240 x 240 and under 3 MB.
- Upload at least two gallery images. The recommended size is 1270 x 760 and each image must be under 3 MB.
- Add a public or unlisted YouTube URL only if the optional video passes rehearsal.
- Keep pricing set to `Free` unless billing ships before launch.

## Launch readiness checklist

Do not schedule the launch until every blocker below is resolved or the stated fallback is approved.

### Hard product blockers

- [ ] Correct every broadcast or fan-out claim in the live Connect page copy and illustration. Product Hunt will open the connection product directly, so there is no truthful fallback for this item.
- [ ] Complete two consecutive addressed deliveries between approved real or clearly labeled demo communities. Confirm that the message arrives once at the named destination with visible attribution.
- [ ] Rehearse the owner flow with a fresh owner or admin invite, channel selection, and active connection. Do not capture the invite.
- [ ] Rehearse the native Buzz join handoff for the community used in gallery frame 2 on the day of capture.

### Account and eligibility blockers

- [ ] Confirm that John Lee's `johnlee3` account is a personal Product Hunt account, has completed onboarding, and is more than one week old.
- [ ] Confirm that neither BuzzRouter nor the `buzzrouter.com` root domain has launched on Product Hunt within the last six months. If it has, follow Product Hunt's relaunch approval process.

### Media and draft blockers

- [ ] Get permission to show two real communities, or prepare two clearly labeled demo communities.
- [ ] Capture and approve the three gallery frames.
- [ ] Export and approve the thumbnail.
- [ ] Decide whether the optional video is dependable enough to include.
- [ ] Complete every Product Hunt field and review the public preview.
- [ ] Select a launch date no more than 30 days ahead, when John can answer questions and help owners for most of the day.

### Measurement checks

- [ ] Confirm that join intent appears in the existing funnel report.
- [ ] Confirm that legitimate submissions can be identified in the database.
- [ ] Confirm that outside owners beginning or completing Connect can be identified.
- [ ] Keep a manual log of repeated Product Hunt questions and feedback.

## Launch-day operating plan

- Share the launch with communities where John already participates. Ask people to try BuzzRouter and leave feedback, not to upvote it.
- Reply to every substantive Product Hunt comment with a concrete answer.
- Send ordinary users to Discover. Send owners to Submit or Connect when their intent is clear.
- Follow up personally with owners who submit or connect a community.
- Fix broken join paths or routing confusion before adding campaign features.

## What success looks like

- Product Hunt visitors describe BuzzRouter as a way for independent Buzz communities to communicate, with discovery as a second benefit.
- The funnel records join intent from someone outside the founding team.
- The database records at least one legitimate outside submission.
- At least one outside owner begins Connect. The target is a completed connection and a successful addressed delivery.
- Product Hunt comments provide specific answers to both feedback questions in the maker comment.
- No launch asset exposes an invite capability, private channel content, secret, or unsupported traction claim.
- The join path and addressed-routing demonstration used in the campaign remain healthy throughout launch day.

## Official Product Hunt references

- [Preparing for launch](https://www.producthunt.com/launch/preparing-for-launch)
- [How to post a product](https://help.producthunt.com/en/articles/479557-how-to-post-a-product)
- [Featuring guidelines](https://help.producthunt.com/en/articles/9883485-product-hunt-featuring-guidelines)
- [How to schedule a post](https://help.producthunt.com/en/articles/2724119-how-to-schedule-a-post)
- [Personal account versus company account](https://help.producthunt.com/en/articles/771527-personal-account-vs-company-account)
- [Product relaunches](https://help.producthunt.com/en/articles/484934-can-i-relaunch-my-product)
- [How to add a Shoutout](https://help.producthunt.com/en/articles/9097078-how-to-add-a-shoutout)
