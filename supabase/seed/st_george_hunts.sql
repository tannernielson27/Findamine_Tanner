-- St. George area hunts (seed 'stgeorge_v1'), written 2026-11-14.
--
-- Six PUBLISHED, APPROVED, public hunts that together exercise every challenge
-- type and most per-hunt / per-stop options:
--   1. Dixie's Pioneer Core          downtown       reading checks, partial credit, sorting recap
--   2. Red Rock Rally                Pioneer Park   TEAM play (self-select), team_debate, data_collection,
--                                                  sketch_draw, hot-cold off, low scaffolding
--   3. Main Street Sketchbook        downtown art   shuffle_stops, hide_scores + growth-only feedback,
--                                                  high scaffolding, sketch_draw, creative_writing
--   4. Snow Canyon: Lava Meets Sandstone           codename_chosen, audio_response, drive-between stops
--   5. Trailblazer Trek              Utah Tech      partial credit, audio_response, mixed progression
--   6. Santa Clara: Flood and Stone  Santa Clara    reading check, data_collection, creative_writing
--
-- Pins come from OpenStreetMap (Nominatim/Overpass, 2026-11-14), not field-checked.
-- Facts players are graded on are stated in that stop's primer, so each hunt
-- grades against its own text. Open-ended stops have no answer key.
--
-- No BEGIN/COMMIT here: deploy-st-george-hunts.sh wraps it in one transaction.
-- Runs once: refuses if already loaded (edit the hunts in the app after that).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.hunts WHERE metadata->>'seed' = 'stgeorge_v1') THEN
    RAISE EXCEPTION 'stgeorge_v1 hunts are already loaded; nothing changed';
  END IF;
END $$;

-- Session-local helper (pg_temp disappears when the connection closes).
-- Same shape as the slc_tremonton_v1 loader, plus optional keys:
--   hunt: play_mode, identity_mode, min_team_size, max_team_size, meta (merged into metadata)
--   stop: scaffolding (high|medium|low), hot_cold (bool), reading_check ({enabled, questions[]})
CREATE FUNCTION pg_temp.seed_hunt(h jsonb) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_owner uuid := '30311ea4-86e5-4b14-b6be-b0fcae634c38';  -- Tanner (admin)
  v_meta jsonb := jsonb_build_object('seed', 'stgeorge_v1', 'region', h->>'region');
  v_gmin int := (h->>'grade_min')::int;
  v_gmax int := (h->>'grade_max')::int;
  v_hunt uuid; v_loc uuid; v_primer uuid; v_task uuid;
  s jsonb; i bigint;
BEGIN
  INSERT INTO public.hunts (title, description, target_audience, play_mode, identity_mode, status, is_public, review_status,
    center_latitude, center_longitude, search_radius_km, estimated_duration_min, grade_range_min, grade_range_max,
    subject_domains, theme, theme_narrative, difficulty_progression, min_team_size, max_team_size, metadata, created_by)
  VALUES (h->>'title', h->>'description', h->>'audience',
    coalesce(h->>'play_mode', 'solo'), coalesce(h->>'identity_mode', 'codename_assigned'),
    'draft', false, 'not_submitted',
    (h->>'lat')::float8, (h->>'lng')::float8, (h->>'radius_km')::float8, (h->>'minutes')::int, v_gmin, v_gmax,
    ARRAY(SELECT jsonb_array_elements_text(h->'domains')), h->>'theme', h->>'narrative', h->>'progression',
    coalesce((h->>'min_team_size')::int, 1), coalesce((h->>'max_team_size')::int, 6),
    coalesce(h->'meta', '{}'::jsonb) || v_meta, v_owner)
  RETURNING id INTO v_hunt;

  FOR s, i IN SELECT e, o - 1 FROM jsonb_array_elements(h->'stops') WITH ORDINALITY AS t(e, o) LOOP
    INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, safety_notes, is_library, metadata, created_by)
    VALUES (s->>'place', (s->>'lat')::float8, (s->>'lng')::float8,
      format('SRID=4326;POINT(%s %s)', s->>'lng', s->>'lat')::extensions.geography,
      (s->>'radius')::real, s->>'loc_type', s->>'safety', false, v_meta, v_owner)
    RETURNING id INTO v_loc;

    v_primer := NULL;
    IF s ? 'primer' THEN
      INSERT INTO public.primers (title, content, subject_domain, grade_range_min, grade_range_max, is_library,
        location_dependency, location_type, difficulty_rating, tags, estimated_minutes, created_by)
      VALUES (s->'primer'->>'title', jsonb_build_object('text', s->'primer'->>'text', 'items', s->'primer'->'items'),
        s->>'domain', v_gmin, v_gmax, false, 'location_specific', s->>'loc_type', 3,
        ARRAY['stgeorge_v1']::text[], 2, v_owner)
      RETURNING id INTO v_primer;
    END IF;

    INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
      difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
    VALUES (s->>'task_title', s->>'domain', s->>'type', s->'content', v_gmin, v_gmax,
      2, 3, false, 'location_specific', s->>'loc_type', ARRAY['stgeorge_v1']::text[], 3, v_owner)
    RETURNING id INTO v_task;

    INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints,
      hot_cold_enabled, scaffolding_level, reading_check, metadata)
    VALUES (v_hunt, v_loc, v_task, v_primer, i, s->>'clue', s->'hints',
      coalesce((s->>'hot_cold')::boolean, true), coalesce(s->>'scaffolding', 'medium'), s->'reading_check', v_meta);
  END LOOP;

  -- Publish last: inserting finds requeues a hunt, so approval has to come after them.
  UPDATE public.hunts
     SET status = 'published', is_public = true, review_status = 'approved', review_reason = NULL,
         review_submitted_at = now(), reviewed_at = now(), reviewed_by = v_owner,
         safety_affirmed_at = now(), safety_affirmed_by = v_owner
   WHERE id = v_hunt;
  RETURN v_hunt;
END $f$;

-- ───────────────────────── 1. Dixie's Pioneer Core ─────────────────────────
SELECT pg_temp.seed_hunt($j${
  "region": "St. George", "title": "Dixie's Pioneer Core",
  "description": "Why would anyone try to grow cotton in the desert? Walk downtown St. George from the red sandstone Tabernacle to Brigham Young's winter home and finish at the white temple whose foundation was pounded in with a cannon. About 1.5 miles, mostly flat.",
  "audience": "family", "grade_min": 3, "grade_max": 12, "minutes": 60, "lat": 37.1065, "lng": -113.5820, "radius_km": 1.2,
  "domains": ["history_community", "math_real_world"], "progression": "ascending",
  "theme": "The Cotton Mission",
  "narrative": "In 1861, hundreds of families were sent to a hot, dry valley to grow cotton. Follow their trail through downtown and piece together how a mission became a city. St. George is hot most of the year: carry water.",
  "stops": [
    {"place": "St. George Tabernacle", "lat": 37.107827, "lng": -113.583784, "radius": 45, "loc_type": "historic",
     "domain": "history_community", "scaffolding": "high",
     "clue": "Start at the red stone building with a tall white clock tower on Main Street.",
     "hints": ["It is on Main Street, south of St. George Boulevard.", "Look up for a white steeple with a clock.", "The St. George Tabernacle."],
     "primer": {"title": "The Cotton Mission", "text": "In 1861, Brigham Young sent about 300 families to this valley to grow cotton, because the warm weather was like the American South. That is why this area is still called Utah's Dixie. The settlers started building this Tabernacle in 1863 from red sandstone cut nearby, and they finished it in 1876.", "items": ["Settlers arrive: 1861", "Tabernacle started: 1863", "Tabernacle finished: 1876", "Nickname: Utah's Dixie"]},
     "reading_check": {"enabled": true, "questions": [
       {"question": "What crop were the settlers sent here to grow?", "options": ["Cotton", "Wheat", "Apples", "Rice"], "correct_answer": "Cotton"}]},
     "task_title": "Built by hand", "type": "numeric_entry",
     "content": {"question": "How many years did it take to build the Tabernacle?", "correct_answer": "13", "partial_answers": {"12": 0.5, "14": 0.5}, "unit": "years", "hints": ["Both years are in the primer.", "Subtract the start year from the finish year.", "1876 - 1863."]}},
    {"place": "Town Square and the St. George Carousel", "lat": 37.107527, "lng": -113.584985, "radius": 50, "loc_type": "park",
     "domain": "science_nature", "scaffolding": "high",
     "clue": "Walk one block west to the park with a carousel and water you can splash in.",
     "hints": ["It is right behind the Tabernacle, to the west.", "Listen for kids and running water.", "Town Square Park."],
     "primer": {"title": "Water is everything", "text": "This valley gets very little rain. To grow anything, the settlers dug ditches to carry water from the rivers to their fields and gardens. The water channels in this park are a reminder of those ditches.", "items": ["Very little rain falls here", "Settlers dug ditches to move river water to their crops"]},
     "task_title": "Follow the water", "type": "photo_observation",
     "content": {"question": "Take a photo of water moving in the park. Try to show where it comes from or where it goes.", "correct_answer": null, "hints": ["Look for channels, not just the splash pad.", "Follow the water with your eyes.", "Any photo of moving water counts."]}},
    {"place": "Judd's Store", "lat": 37.108342, "lng": -113.584464, "radius": 30, "loc_type": "historic",
     "domain": "reading_writing",
     "clue": "Find the old-fashioned little store on Tabernacle Street, just around the corner from the park.",
     "hints": ["It is on Tabernacle Street, near Main.", "It looks like it belongs in an old photo.", "Judd's Store."],
     "task_title": "A pioneer kid's day", "type": "creative_writing",
     "content": {"question": "Imagine you are a kid in St. George in the 1860s. Write 3 or 4 sentences in your diary about a hot day: what chores you did, what you ate, and what you would buy at a store if you could.", "correct_answer": null, "hints": ["Think about water, heat and hard work.", "Pioneers had no air conditioning or cars.", "Any honest diary entry counts."]}},
    {"place": "Brigham Young Winter Home", "lat": 37.111337, "lng": -113.584793, "radius": 35, "loc_type": "historic",
     "domain": "history_community",
     "clue": "Walk north across St. George Boulevard to a two-story pioneer home on 200 North.",
     "hints": ["Cross St. George Boulevard at the light.", "It is on the corner of 100 West and 200 North.", "Brigham Young's Winter Home."],
     "safety": "St. George Boulevard is a busy street. Cross only at the crosswalk.",
     "primer": {"title": "Wintering in Dixie", "text": "Brigham Young led the church from Salt Lake City, where winters are cold. In the last years of his life, he spent winters here in St. George because the weather was warm. He died in 1877, the same year the temple you will visit next was dedicated.", "items": ["Brigham Young spent his last winters here", "He died in 1877"]},
     "task_title": "Snowbird", "type": "multiple_choice",
     "content": {"question": "Why did Brigham Young spend his winters in St. George?", "options": ["The winters are warm here", "He was born here", "There were no roads to Salt Lake City", "To go skiing"], "correct_answer": "The winters are warm here", "hints": ["Read the primer.", "Think about the weather.", "Salt Lake is cold in winter; St. George is not."]}},
    {"place": "St. George Utah Temple (grounds)", "lat": 37.100529, "lng": -113.578098, "radius": 80, "loc_type": "historic",
     "domain": "history_community",
     "clue": "Finish at the bright white building with a tall white tower, about a mile southeast, surrounded by green lawns.",
     "hints": ["Head south and east from downtown.", "It is near 200 East and 400 South.", "The St. George Utah Temple. Stay on the public grounds."],
     "primer": {"title": "A cannon for a hammer", "text": "The St. George Temple was dedicated in 1877. It was the first temple the church finished in Utah. The ground here was soft and wet, so the builders pounded black volcanic rock into the foundation. To do it, they used an old cannon as a heavy pile driver, lifting it and dropping it again and again.", "items": ["Dedicated: 1877", "The first temple finished in Utah", "An old cannon pounded volcanic rock into the foundation"]},
     "reading_check": {"enabled": true, "questions": [
       {"question": "What did the builders use to pound rock into the foundation?", "options": ["An old cannon", "A steam engine", "Oxen stomping", "A giant hammer made of wood"], "correct_answer": "An old cannon"}]},
     "task_title": "Mission timeline", "type": "sorting_ordering",
     "content": {"question": "Put these in order, earliest first.", "items": ["The Tabernacle is finished", "The temple is dedicated", "Settlers arrive to grow cotton", "Work on the Tabernacle begins"], "correct_order": ["Settlers arrive to grow cotton", "Work on the Tabernacle begins", "The Tabernacle is finished", "The temple is dedicated"], "hints": ["You saw each date in a primer.", "1861, 1863, 1876, 1877.", "The settlers came first."]}}
  ]
}$j$::jsonb);

-- ───────────────────────── 2. Red Rock Rally (team hunt) ─────────────────────────
SELECT pg_temp.seed_hunt($j${
  "region": "St. George", "title": "Red Rock Rally: Pioneer Park",
  "description": "A team hunt through Pioneer Park's red sandstone: read 190-million-year-old sand dunes, squeeze through a slot canyon, argue it out at a pioneer cabin and finish at a desert garden with fish found almost nowhere else. Form a team of 2 to 5 on the hunt page before you start. About 1.5 miles with some scrambling.",
  "audience": "teens", "grade_min": 6, "grade_max": 12, "minutes": 70, "lat": 37.1155, "lng": -113.5775, "radius_km": 0.8,
  "play_mode": "team_self_select", "min_team_size": 2, "max_team_size": 5,
  "domains": ["science_nature", "history_community"], "progression": "mixed",
  "theme": "Desert field team",
  "narrative": "Your team is a field crew sent to read the rocks, the water and the past. Every stop needs everyone. Stay together, bring lots of water, and skip this hunt in the middle of a summer afternoon.",
  "stops": [
    {"place": "Pioneer Park Trailhead", "lat": 37.114936, "lng": -113.577911, "radius": 50, "loc_type": "park",
     "domain": "science_nature",
     "safety": "Rocks get very hot and can drop off suddenly. Stay back from edges and keep everyone in sight.",
     "clue": "Meet your team where Skyline Drive enters the red rocks of Pioneer Park, above downtown.",
     "hints": ["It is on the red hill just north of downtown, along Skyline Drive.", "Look for the main parking area.", "The Pioneer Park trailhead."],
     "primer": {"title": "Frozen sand dunes", "text": "The red rock all around you is Navajo Sandstone. About 190 million years ago, this area was a huge desert of sand dunes, bigger than the Sahara. Wind piled sand into dunes, and the slanted lines you see in the rock are the old faces of those dunes. Geologists call these lines cross-bedding.", "items": ["Navajo Sandstone: about 190 million years old", "Slanted lines = cross-bedding from wind-blown dunes"]},
     "task_title": "Read the lines", "type": "multiple_choice",
     "content": {"question": "What made the slanted lines in the sandstone?", "options": ["Wind piling sand into dunes", "Waves at the bottom of an ocean", "Ice scraping the rock", "Pioneers carving the rock"], "correct_answer": "Wind piling sand into dunes", "hints": ["Read the primer.", "The lines are called cross-bedding.", "Think desert, not ocean."]}},
    {"place": "Pioneer cabin, Pioneer Park", "lat": 37.115528, "lng": -113.577608, "radius": 40, "loc_type": "historic",
     "domain": "critical_thinking", "scaffolding": "low",
     "clue": "Find the small old cabin inside the park, just a short walk from the trailhead.",
     "hints": ["It is close to the main road through the park.", "It is small and much older than anything around it.", "The pioneer cabin."],
     "task_title": "Where would you build?", "type": "team_debate",
     "content": {"question": "It is 1861 and your team must pick a spot for your family's home: up here on the rocks with a view and no mud, or down in the valley next to the creek where floods can happen. Debate it. Every teammate gives one reason. Then write your team's choice and your two best reasons.", "correct_answer": null, "hints": ["Think about water, heat, safety and farming.", "Listen to everyone before you vote.", "There is no wrong choice, only weak reasons."]}},
    {"place": "The DIXIE rock (Sugarloaf)", "lat": 37.115558, "lng": -113.579871, "radius": 50, "loc_type": "park",
     "domain": "history_community",
     "safety": "Do not climb up to the letters. Take your photo from the trail.",
     "clue": "Look west for a big rock with a giant word painted on it in white letters. Get your team close enough to read it.",
     "hints": ["It is on the west side of the park, above downtown.", "The rock is called the Sugarloaf.", "The word is the town's nickname."],
     "primer": {"title": "Painted pride", "text": "The white letters on the Sugarloaf spell DIXIE, the nickname this area got from the Cotton Mission of 1861. You can see the word from much of downtown.", "items": ["DIXIE is painted on the Sugarloaf rock", "The nickname comes from the Cotton Mission"]},
     "task_title": "Team portrait", "type": "photo_observation",
     "content": {"question": "Take a team photo with the painted rock behind you. Every teammate must be in the shot.", "correct_answer": null, "hints": ["Use a timer or ask someone nearby.", "Stand far enough back to fit the whole word.", "Stay on the trail."]}},
    {"place": "St. George Narrows (Pioneer Park slot)", "lat": 37.116954, "lng": -113.575775, "radius": 45, "loc_type": "park",
     "domain": "math_real_world", "scaffolding": "low", "hot_cold": false,
     "safety": "Do not enter the slot if it is raining or rain is coming. Go one at a time in tight spots.",
     "clue": "Find the narrow crack in the rock that you can walk through, on the east side of the park.",
     "hints": ["Head east along the main trail.", "Look for a crack between two walls of sandstone.", "The St. George Narrows."],
     "task_title": "Measure the squeeze", "type": "data_collection",
     "content": {"question": "Find the narrowest spot your team can safely reach. Record: (1) how many hand-widths wide it is, (2) about how tall the walls are compared to your tallest teammate, and (3) whether the air feels cooler inside than outside.", "correct_answer": null, "hints": ["Use the same person's hand for every measurement.", "Estimate wall height as 'about X teammates tall'.", "Write all three numbers."]}},
    {"place": "Red Hills Desert Garden", "lat": 37.113853, "lng": -113.574566, "radius": 60, "loc_type": "park",
     "domain": "science_nature",
     "clue": "Finish just below the park, at a garden full of cactus and desert plants with a little stream running through it.",
     "hints": ["It is downhill to the southeast, along Red Hills Parkway.", "Look for a stream with a fish viewing area.", "The Red Hills Desert Garden."],
     "primer": {"title": "Plants that sip", "text": "Everything in this garden grows on very little water. Desert plants save water with thick waxy skin, tiny or no leaves, spines and deep roots. The stream is home to fish from the Virgin River, like the woundfin and the Virgin River chub. Both are endangered and live in almost no other river on Earth.", "items": ["Desert plants: waxy skin, spines, small leaves, deep roots", "Woundfin and Virgin River chub are endangered native fish"]},
     "task_title": "Field sketch", "type": "sketch_draw",
     "content": {"question": "As a team, pick one plant (or one fish in the stream). Sketch it and label one way it survives in the desert.", "correct_answer": null, "hints": ["Look closely at its skin, leaves and spines.", "Check the primer for adaptations.", "Simple sketches are fine. The label matters most."]}}
  ]
}$j$::jsonb);

-- ───────────────────────── 3. Main Street Sketchbook (shuffled, scores hidden) ─────────────────────────
SELECT pg_temp.seed_hunt($j${
  "region": "St. George", "title": "Main Street Sketchbook",
  "description": "A no-pressure art walk for young explorers. Draw, imagine and write your way around downtown St. George. Every player gets the stops in a different order, there are no scores, and there are no wrong answers. About 1 mile, all flat.",
  "audience": "kids", "grade_min": 1, "grade_max": 6, "minutes": 45, "lat": 37.1095, "lng": -113.5840, "radius_km": 0.6,
  "domains": ["reading_writing", "critical_thinking"], "progression": "plateau",
  "meta": {"shuffle_stops": true, "hide_scores": true, "hide_leaderboard": true, "hide_timer": true, "growth_only_feedback": true},
  "theme": "Artist's notebook",
  "narrative": "Today you are an artist with a secret sketchbook. Every stop gives you something to draw or dream up. Grown-ups: hold hands at street crossings.",
  "stops": [
    {"place": "\"Dad\" sculpture", "lat": 37.111571, "lng": -113.583307, "radius": 40, "loc_type": "urban",
     "domain": "critical_thinking", "scaffolding": "high",
     "clue": "Find the outdoor sculpture called Dad, a short walk north of St. George Boulevard near Main Street.",
     "hints": ["It is north of St. George Boulevard.", "It is east of Main Street, by the shops.", "Look for a statue outdoors."],
     "task_title": "Draw what you see", "type": "sketch_draw",
     "content": {"question": "Draw the sculpture. Then add one thing to your drawing that is not really there.", "correct_answer": null, "hints": ["Start with big shapes.", "Then add small details.", "Your added thing can be silly."]}},
    {"place": "St. George Carousel", "lat": 37.107527, "lng": -113.584985, "radius": 40, "loc_type": "park",
     "domain": "critical_thinking", "scaffolding": "high",
     "clue": "Find the merry-go-round in Town Square Park.",
     "hints": ["It is in the park behind the Tabernacle.", "It goes round and round.", "The St. George Carousel."],
     "task_title": "Invent a ride", "type": "sketch_draw",
     "content": {"question": "Look at the carousel animals. Now draw a brand-new animal you would want to ride on the carousel.", "correct_answer": null, "hints": ["Mix two animals together.", "Give it a fun color or pattern.", "Any animal you invent is great."]}},
    {"place": "St. George Art Museum", "lat": 37.111880, "lng": -113.582339, "radius": 40, "loc_type": "urban",
     "domain": "reading_writing", "scaffolding": "high",
     "clue": "Find the city's art museum, on 100 East a little north of St. George Boulevard.",
     "hints": ["It is near the old Opera House.", "Look for a sign that says Art Museum.", "The St. George Art Museum."],
     "task_title": "Name the painting", "type": "creative_writing",
     "content": {"question": "Imagine the most amazing painting is hanging inside. Give it a title and write two sentences about what it shows.", "correct_answer": null, "hints": ["What colors are in it?", "Is there a person, animal or place?", "Any idea you have is perfect."]}},
    {"place": "St. George Children's Museum", "lat": 37.106836, "lng": -113.583855, "radius": 40, "loc_type": "urban",
     "domain": "math_real_world", "scaffolding": "high",
     "clue": "Find the museum made just for kids, on Main Street south of the Tabernacle.",
     "hints": ["It is on Main Street.", "It is south of the Tabernacle.", "The St. George Children's Museum."],
     "task_title": "Shape hunt", "type": "data_collection",
     "content": {"question": "Look at the outside of the building. Count how many circles, squares and triangles you can find. Write all three numbers.", "correct_answer": null, "hints": ["Windows and doors are often squares.", "Look at signs and decorations.", "Any honest count is right."]}},
    {"place": "Saint George Library", "lat": 37.106852, "lng": -113.585071, "radius": 40, "loc_type": "urban",
     "domain": "reading_writing", "scaffolding": "high",
     "clue": "Find the library on 100 South, right next to Town Square Park.",
     "hints": ["It is next to the park.", "It is full of books.", "The St. George Library."],
     "task_title": "Red rock poem", "type": "creative_writing",
     "content": {"question": "Look around for red rocks on the hills. Write a 3-line poem about them.", "correct_answer": null, "hints": ["Line 1: what you see.", "Line 2: what it feels like.", "Line 3: something surprising."]}}
  ]
}$j$::jsonb);

-- ───────────────────────── 4. Snow Canyon: Lava Meets Sandstone ─────────────────────────
SELECT pg_temp.seed_hunt($j${
  "region": "St. George", "title": "Snow Canyon: Lava Meets Sandstone",
  "description": "A drive-and-hike hunt through Snow Canyon State Park in Ivins. Hear a slot canyon, find names pioneers left on the rock, read petrified dunes and end at a cave made by flowing lava. Drive between stops; each stop is a short walk from parking. State park entrance fee required.",
  "audience": "adults", "grade_min": 9, "grade_max": 16, "minutes": 150, "lat": 37.2050, "lng": -113.6450, "radius_km": 3.5,
  "identity_mode": "codename_chosen",
  "domains": ["science_nature", "history_community"], "progression": "ascending",
  "theme": "Two kinds of rock",
  "narrative": "Snow Canyon is a story told in two rocks: ancient red and white sandstone, and young black lava that poured over it. Pick your own codename, then work from the south end of the park to the north. Carry plenty of water: there is little shade.",
  "stops": [
    {"place": "Jenny's Canyon", "lat": 37.188410, "lng": -113.643181, "radius": 60, "loc_type": "trail",
     "domain": "science_nature", "hot_cold": false,
     "safety": "Short sandy trail. Stay out of slot canyons when rain is possible.",
     "clue": "Start near the south end of the park at a short trail to a tiny slot canyon.",
     "hints": ["Drive in from the south entrance on Snow Canyon Drive.", "The trailhead is on the east side of the road.", "Jenny's Canyon trail."],
     "primer": {"title": "Not about snow", "text": "Snow Canyon is not named for snow, which almost never falls here. It is named after Lorenzo Snow and Erastus Snow, two pioneer leaders in southern Utah.", "items": ["Named for Lorenzo and Erastus Snow", "Not named for the weather"]},
     "reading_check": {"enabled": true, "questions": [
       {"question": "Who is Snow Canyon named after?", "options": ["Two pioneer leaders named Snow", "The snow that falls here each winter", "A miner named Jenny Snow", "White sand that looks like snow"], "correct_answer": "Two pioneer leaders named Snow"}]},
     "task_title": "Canyon acoustics", "type": "audio_response",
     "content": {"question": "Stand inside the slot. Record 15 to 30 seconds describing what you hear and how your voice sounds compared to outside the canyon.", "correct_answer": null, "hints": ["Try speaking softly, then normally.", "Listen for echoes, wind or birds.", "Any honest description counts."]}},
    {"place": "Pioneer Names", "lat": 37.196651, "lng": -113.644676, "radius": 60, "loc_type": "trail",
     "domain": "history_community", "hot_cold": false,
     "safety": "Look but never touch or add to the names. Marking rock in a state park is illegal.",
     "clue": "Drive a little farther north to a short trail leading to names written under a rock overhang.",
     "hints": ["The trailhead is on the west side of Snow Canyon Drive.", "Look under the overhang at the base of the cliff.", "The Pioneer Names trail."],
     "primer": {"title": "Signed in grease", "text": "In the 1880s, pioneers passing through wrote their names on this rock using axle grease, the thick grease used on wagon wheels. The overhang has protected the writing from rain ever since.", "items": ["Names written in the 1880s", "Written with wagon axle grease"]},
     "task_title": "What wrote the names?", "type": "multiple_choice",
     "content": {"question": "What did the pioneers use to write their names here?", "options": ["Axle grease", "Paint", "Charcoal", "Carved with knives"], "correct_answer": "Axle grease", "hints": ["Read the primer.", "It came from their wagons.", "It is thick and dark."]}},
    {"place": "Petrified Dunes", "lat": 37.213695, "lng": -113.645441, "radius": 80, "loc_type": "trail",
     "domain": "science_nature", "scaffolding": "low",
     "safety": "Sandstone can be slick, and drop-offs come up suddenly. Stay away from edges.",
     "clue": "Drive north to the rounded, swirled hills of sandstone right beside the road.",
     "hints": ["It is in the middle of the park, just west of the road.", "The rock looks like frozen waves.", "The Petrified Dunes trail."],
     "primer": {"title": "Dunes turned to stone", "text": "This is Navajo Sandstone, made from desert sand dunes about 190 million years ago. Over time the sand was buried, pressed and cemented into rock. Wind then carved it into these rounded shapes. The tilted lines inside are the old dune faces.", "items": ["Navajo Sandstone: about 190 million years old", "Sand dunes buried and cemented into rock"]},
     "task_title": "Field notes", "type": "data_collection",
     "content": {"question": "Pick one rock face with clear tilted lines. Record: (1) the main colors you see, (2) roughly what angle the lines tilt (flat, gentle or steep), and (3) whether the lines all tilt the same way or cross each other.", "correct_answer": null, "hints": ["Step back to see the whole pattern.", "Crossing sets of lines mean the wind changed direction.", "Write all three observations."]}},
    {"place": "Lava Tube #1", "lat": 37.222108, "lng": -113.647892, "radius": 50, "loc_type": "trail",
     "domain": "science_nature", "scaffolding": "low", "hot_cold": false,
     "safety": "The tube is dark, rocky and uneven. Bring a flashlight, watch your head and follow any posted closures.",
     "clue": "Finish at the north end of the park. From the Lava Flow trailhead, walk out across the black rock to a cave opening in the lava.",
     "hints": ["Park at the Lava Flow trailhead.", "Follow the trail west over the black rock.", "Look for a hole in the ground leading down into a tube."],
     "primer": {"title": "A pipe made of lava", "text": "The black rock here is lava, far younger than the sandstone under it. It flowed down into the canyon after the canyon had already been carved. As a lava flow moves, its surface cools into a hard crust while hot lava keeps flowing underneath. When that lava drains away, it leaves a hollow tube.", "items": ["Lava is much younger than the sandstone", "Lava flowed into a canyon that already existed", "Tubes form when lava drains out from under a cooled crust"]},
     "task_title": "Snow Canyon's story", "type": "sorting_ordering",
     "content": {"question": "Put Snow Canyon's story in order, earliest first.", "items": ["Lava flows down into the canyon", "Wind piles up a huge desert of sand dunes", "The canyon is carved into the sandstone", "Lava drains out and leaves a tube", "The sand is buried and turns into sandstone"], "correct_order": ["Wind piles up a huge desert of sand dunes", "The sand is buried and turns into sandstone", "The canyon is carved into the sandstone", "Lava flows down into the canyon", "Lava drains out and leaves a tube"], "hints": ["Rock on the bottom is older than rock on top.", "The lava flowed into a canyon that was already there.", "Dunes first, tube last."]}}
  ]
}$j$::jsonb);

-- ───────────────────────── 5. Trailblazer Trek: Utah Tech University ─────────────────────────
SELECT pg_temp.seed_hunt($j${
  "region": "St. George", "title": "Trailblazer Trek: Utah Tech University",
  "description": "A school that has had more names than most people have had addresses. Walk Utah Tech University from the fine arts center to the football stadium, read a campus monument, run a quick people count and finish by calling the game. About 1 mile.",
  "audience": "teens", "grade_min": 9, "grade_max": 16, "minutes": 45, "lat": 37.1025, "lng": -113.5660, "radius_km": 0.7,
  "domains": ["history_community", "math_real_world"], "progression": "mixed",
  "theme": "Campus scout",
  "narrative": "You are scouting campus for a future student. Learn its story, take its pulse and pitch it. Watch for bikes and scooters on campus paths.",
  "stops": [
    {"place": "Eccles Fine Arts Center", "lat": 37.105328, "lng": -113.567352, "radius": 50, "loc_type": "campus",
     "domain": "math_real_world",
     "clue": "Start at the north end of campus at the fine arts center.",
     "hints": ["It is on the north side of campus, near the theaters.", "Look for music and theater signs.", "The Eccles Fine Arts Center."],
     "primer": {"title": "One school, many names", "text": "This university started in 1911 as the St. George Stake Academy. Over the years it became Dixie College, then Dixie State University in 2013. In 2022 it was renamed Utah Tech University.", "items": ["Founded: 1911", "Dixie State University: 2013", "Utah Tech University: 2022"]},
     "task_title": "Name game", "type": "numeric_entry",
     "content": {"question": "How many years passed between the school's founding and its renaming as Utah Tech University?", "correct_answer": "111", "partial_answers": {"110": 0.5, "112": 0.5}, "unit": "years", "hints": ["Both years are in the primer.", "Subtract the founding year.", "2022 - 1911."]}},
    {"place": "Encampment Mall Monument", "lat": 37.104021, "lng": -113.565210, "radius": 40, "loc_type": "campus",
     "domain": "reading_writing",
     "clue": "Walk southeast into the long open lawn in the middle of campus and find the monument on it.",
     "hints": ["The lawn is called Encampment Mall.", "Look for a monument with words on it.", "It is near the north end of the lawn."],
     "task_title": "Read the stone", "type": "short_text",
     "content": {"question": "Read the monument. In one sentence, in your own words, write what or who it honors.", "correct_answer": null, "hints": ["Read every side.", "Look for names and dates.", "Your own words, one sentence."]}},
    {"place": "Clock Tower", "lat": 37.103142, "lng": -113.565231, "radius": 40, "loc_type": "campus",
     "domain": "math_real_world", "scaffolding": "low",
     "clue": "Head to the south end of the lawn, where a tower keeps time for the whole campus.",
     "hints": ["It is at the south end of Encampment Mall.", "Look up.", "The clock tower."],
     "task_title": "Take the pulse", "type": "data_collection",
     "content": {"question": "Stand by the clock tower for two minutes. Tally everyone who passes: walking, on a bike, on a scooter or skateboard, and other. Write your four totals and which one won.", "correct_answer": null, "hints": ["Make four columns before you start.", "Count each person once.", "Any honest count is right."]}},
    {"place": "Holland Centennial Commons", "lat": 37.102680, "lng": -113.565916, "radius": 50, "loc_type": "campus",
     "domain": "math_real_world",
     "clue": "Find the big building just southwest of the clock tower that holds the campus library.",
     "hints": ["It is a short walk from the clock tower.", "Students come here to study.", "Holland Centennial Commons."],
     "primer": {"title": "A hundred years", "text": "Centennial means a 100th anniversary. This building's name celebrates the school turning 100 years old. You already know the year it was founded.", "items": ["Centennial = 100 years"]},
     "task_title": "Birthday year", "type": "numeric_entry",
     "content": {"question": "In what year did the school turn 100?", "correct_answer": "2011", "hints": ["The founding year is in the first primer.", "Add 100 to it.", "1911 + 100."]}},
    {"place": "Greater Zion Stadium", "lat": 37.099574, "lng": -113.567388, "radius": 70, "loc_type": "campus",
     "domain": "reading_writing",
     "clue": "Finish at the south end of campus at the home of Trailblazer football.",
     "hints": ["Walk south past Burns Arena.", "Look for stadium lights.", "Greater Zion Stadium."],
     "task_title": "Call the game", "type": "audio_response",
     "content": {"question": "Record a 20 to 30 second announcer intro for a Trailblazers home game here. Mention one thing you learned about the school today.", "correct_answer": null, "hints": ["Start big: Welcome to Greater Zion Stadium!", "Drop in a date or name from the hunt.", "Have fun with it."]}}
  ]
}$j$::jsonb);

-- ───────────────────────── 6. Santa Clara: Flood and Stone ─────────────────────────
SELECT pg_temp.seed_hunt($j${
  "region": "Santa Clara", "title": "Santa Clara: Flood and Stone",
  "description": "In 1862 a flood washed away Santa Clara's first fort. Walk the historic district of Swiss settler homes, visit the stone house Jacob Hamblin built on higher ground afterward, and finish at the river that caused it all. About 1.2 miles, mostly flat.",
  "audience": "family", "grade_min": 3, "grade_max": 10, "minutes": 50, "lat": 37.1325, "lng": -113.6580, "radius_km": 0.9,
  "domains": ["history_community", "science_nature"], "progression": "ascending",
  "theme": "Rebuild after the flood",
  "narrative": "Santa Clara's settlers learned the hard way that a desert river can turn dangerous. Follow their story from the town's heritage square to the river. Santa Clara Drive is busy: use the sidewalk and crosswalks.",
  "stops": [
    {"place": "Heritage Square, Santa Clara", "lat": 37.133303, "lng": -113.653559, "radius": 45, "loc_type": "historic",
     "domain": "history_community",
     "clue": "Start at the little square on Santa Clara Drive surrounded by old pioneer homes and a history museum.",
     "hints": ["It is in the old part of town on Santa Clara Drive.", "Look for the historical society museum.", "Heritage Square."],
     "primer": {"title": "Swiss in the desert", "text": "In 1861, a group of settlers from Switzerland was sent to Santa Clara. They planted orchards and vineyards and built many of the old houses along this street.", "items": ["Swiss settlers arrived: 1861", "They planted orchards and grapes"]},
     "task_title": "Where from?", "type": "multiple_choice",
     "content": {"question": "Which country did many of Santa Clara's early settlers come from?", "options": ["Switzerland", "Mexico", "Ireland", "Japan"], "correct_answer": "Switzerland", "hints": ["Read the primer.", "It is a mountain country in Europe.", "Look for the Swiss Pioneer Memorial nearby."]}},
    {"place": "Swiss Pioneer Memorial Park", "lat": 37.134391, "lng": -113.654981, "radius": 45, "loc_type": "park",
     "domain": "history_community",
     "clue": "Walk a short way northwest to the small park that honors the Swiss pioneers.",
     "hints": ["It is just north of Santa Clara Drive.", "It is very close to Heritage Square.", "Swiss Pioneer Memorial Park."],
     "task_title": "Pioneer names", "type": "photo_observation",
     "content": {"question": "Find a plaque or marker in the park. Take a photo of a family name or a date on it.", "correct_answer": null, "hints": ["Look for stone or metal plaques.", "Read up close.", "Any name or date counts."]}},
    {"place": "Jacob Hamblin House", "lat": 37.133735, "lng": -113.661424, "radius": 40, "loc_type": "historic",
     "domain": "history_community",
     "clue": "Walk west to a sturdy two-story house made of sandstone blocks on Hamblin Drive.",
     "hints": ["It is about half a mile west of Heritage Square.", "It sits next to another old stone house.", "The Jacob Hamblin Home."],
     "primer": {"title": "Higher ground", "text": "Jacob Hamblin was a pioneer missionary and scout who worked with the Southern Paiute people. In January 1862, a huge flood on the Santa Clara River washed away the settlers' first fort. Afterward, Hamblin built this stone house on higher ground, finishing it in 1863.", "items": ["1862: a flood washed away the first fort", "Hamblin built this stone house on higher ground", "Finished: 1863"]},
     "reading_check": {"enabled": true, "questions": [
       {"question": "What destroyed the settlers' first fort in 1862?", "options": ["A flood", "A fire", "An earthquake", "A windstorm"], "correct_answer": "A flood"}]},
     "task_title": "Why up here?", "type": "multiple_choice",
     "content": {"question": "Why did Jacob Hamblin build his stone house on higher ground?", "options": ["To stay safe from river floods", "To get a better view of the mountains", "Because the soil was better", "To be closer to the road"], "correct_answer": "To stay safe from river floods", "hints": ["Read the primer.", "Think about what happened in 1862.", "Water flows downhill."]}},
    {"place": "Frederick Jr. and Mary F. Reber House", "lat": 37.133854, "lng": -113.660561, "radius": 35, "loc_type": "historic",
     "domain": "reading_writing",
     "clue": "Step next door to the old house just east of the Hamblin house, built by one of the Swiss families.",
     "hints": ["It is on Hamblin Drive.", "It is right next to the Jacob Hamblin House.", "The Reber House."],
     "task_title": "Letter home", "type": "creative_writing",
     "content": {"question": "It is 1862 and you just lived through the flood. Write a short letter (4 or 5 sentences) to family back in Switzerland: what happened, what you lost, and why you are building on higher ground.", "correct_answer": null, "hints": ["Start with Dear and a name.", "Use what you learned at the Hamblin house.", "Any honest letter counts."]}},
    {"place": "Santa Clara River at Gates Lane", "lat": 37.128870, "lng": -113.663888, "radius": 60, "loc_type": "water",
     "domain": "science_nature", "scaffolding": "low",
     "safety": "Stay on the trail and out of the river. Never go near the water when it is running high or brown.",
     "clue": "Finish south of the Hamblin house, down at the trailhead beside the river that flooded the fort.",
     "hints": ["Head south on Gates Lane.", "Look for the trailhead parking by the river.", "The Gates Lane trailhead on the Santa Clara River."],
     "task_title": "River report", "type": "data_collection",
     "content": {"question": "Look at the river and its banks. Record: (1) is the water clear, cloudy or brown, (2) about how wide it is in giant steps, and (3) one sign that the water has been much higher before, like debris, cut banks or flattened plants.", "correct_answer": null, "hints": ["Stay on the trail to look.", "Estimate the width; do not walk across.", "Look above the water line for clues."]}}
  ]
}$j$::jsonb);
