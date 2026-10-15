-- College campus hunts (seed 'college_campus_v1'), drafted 2026-10-15 for the BYU undergraduate cohort.
--
-- Creates 4 DRAFT hunts (target_audience 'adults', grades 13-16), 20 stops.
-- Every stop is flagged needs_placement: pins are approximate, and the app
-- blocks publishing until each stop is opened and saved in the hunt editor.
-- Verify every fact marked in docs/COLLEGE_CAMPUS_HUNTS.md before publishing.
--
-- Re-running replaces these drafts (and any edits made to them in the app).
-- Teardown: run only the DELETE block below.

BEGIN;

DELETE FROM public.finds WHERE hunt_id IN (SELECT id FROM public.hunts WHERE metadata->>'seed' = 'college_campus_v1');
DELETE FROM public.hunts WHERE metadata->>'seed' = 'college_campus_v1';
DELETE FROM public.tasks WHERE 'college_campus_v1' = ANY(tags);
DELETE FROM public.primers WHERE 'college_campus_v1' = ANY(tags);
DELETE FROM public.locations WHERE metadata->>'seed' = 'college_campus_v1';

DO $$
DECLARE
  v_owner uuid := '30311ea4-86e5-4b14-b6be-b0fcae634c38';
  v_hunt uuid; v_loc uuid; v_primer uuid; v_task uuid;
BEGIN

  -- ── The Founders' File ──
  INSERT INTO public.hunts (title, description, target_audience, play_mode, identity_mode, status, is_public,
    center_latitude, center_longitude, search_radius_km, estimated_duration_min, grade_range_min, grade_range_max,
    subject_domains, theme, theme_narrative, difficulty_progression, metadata, created_by)
  VALUES ('The Founders'' File', 'An archivist started reconstructing how a one-room academy became a 30,000-student university, then left the file half-finished. Five stops, one timeline, and a few things you can only check in person.', 'adults', 'solo', 'codename_assigned', 'draft', true,
    40.2493, -111.6492, 1, 40, 13, 16,
    ARRAY['history_community', 'critical_thinking']::text[], 'Cold case: campus history', 'You''ve inherited a folder of loose notes and no dates in order. Each stop recovers a piece. By the library, you should be able to put the whole thing back together.', 'ascending', '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_hunt;

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Brigham Square', 40.2497, -111.6493, 'SRID=4326;POINT(-111.6493 40.2497)', 35, 'campus', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  INSERT INTO public.primers (title, content, subject_domain, grade_range_min, grade_range_max, is_library,
    location_dependency, location_type, difficulty_rating, tags, estimated_minutes, created_by)
  VALUES ('An academy, not a university', '{"text": "Brigham Young Academy was founded in Provo in 1875. Karl G. Maeser took charge as principal in 1876 and shaped its culture for years. The school operated as an academy, teaching everything from primary grades up, until it was renamed Brigham Young University in 1903.", "items": ["1875: Brigham Young Academy founded", "1876: Karl G. Maeser becomes principal", "1903: renamed Brigham Young University"]}'::jsonb, 'history_community', 13, 16, false,
    'location_specific', 'campus', 3, ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_primer;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Academy years', 'history_community', 'multiple_choice', '{"question": "How many years did the school run as an academy before it became a university?", "options": ["18", "28", "32", "46"], "correct_answer": "28", "hints": ["Founding year and renaming year are both in the primer.", "Subtract the earlier year from the later one.", "1903 minus 1875."]}'::jsonb, 13, 16,
    2, 3, false, 'location_specific', 'campus', ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 0, 'Start where campus does its people-watching: the open square at the heart of upper campus, named for the man who signed the academy''s founding deed.', '["Upper campus, central, wide-open plaza.", "It sits between the library and the oldest buildings on the hill.", "Look for the plaza called Brigham Square."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Karl G. Maeser Building', 40.2495, -111.649, 'SRID=4326;POINT(-111.649 40.2495)', 35, 'historic', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  INSERT INTO public.primers (title, content, subject_domain, grade_range_min, grade_range_max, is_library,
    location_dependency, location_type, difficulty_rating, tags, estimated_minutes, created_by)
  VALUES ('The chalk circle', '{"text": "Maeser is remembered for a line about honor: lock him behind stone walls and he might find a way out, but draw a chalk circle on the floor and have him promise not to cross it, and he never would. He also told students to ''be yourself, but always your better self.'' The building named for him was finished in 1911, the first on this hill.", "items": ["Stone walls vs. a chalk line and a promise", "''Be yourself, but always your better self''", "Maeser Building: finished 1911, first on upper campus"]}'::jsonb, 'critical_thinking', 13, 16, false,
    'location_specific', 'historic', 4, ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_primer;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Walls or words', 'critical_thinking', 'short_text', '{"question": "Maeser bet on a promise over stone walls. Standing in front of a building made to last a century, write one or two sentences: what actually lasts longer at a university, its buildings or its reputation? Use one detail you can see from here.", "correct_answer": null, "hints": ["There''s no single right answer; you''re graded on making an argument.", "Pick a side, then point at something physical in front of you.", "Example shape: ''X, because ___, and you can see it in ___.''"]}'::jsonb, 13, 16,
    2, 4, false, 'location_specific', 'historic', ARRAY['college_campus_v1']::text[], 4, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 1, 'Find the oldest building on the hill: stone columns, a principal''s name, and the closest thing upper campus has to a cornerstone.', '["It faces the square you just left.", "Look for classical columns on a very old stone facade.", "It''s the Karl G. Maeser Building."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Abraham O. Smoot Administration Building', 40.2492, -111.6488, 'SRID=4326;POINT(-111.6488 40.2492)', 35, 'campus', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  INSERT INTO public.primers (title, content, subject_domain, grade_range_min, grade_range_max, is_library,
    location_dependency, location_type, difficulty_rating, tags, estimated_minutes, created_by)
  VALUES ('Who pays the bills', '{"text": "Abraham O. Smoot, a Provo businessman and former mayor, was one of the academy''s main financial backers and served on its board. Universities often name buildings after donors, founders and leaders, which makes a campus map a record of who mattered to the institution, and when.", "items": ["Smoot: businessman, Provo mayor, academy backer", "Building names record institutional priorities"]}'::jsonb, 'history_community', 13, 16, false,
    'location_specific', 'campus', 4, ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_primer;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Read the evidence', 'history_community', 'photo_observation', '{"question": "Find a date carved, cast or posted anywhere on a building you can see from here: a cornerstone, plaque or dedication. Photograph it (no people in the frame).", "correct_answer": null, "hints": ["Cornerstones are usually low on a front corner.", "Plaques tend to sit beside main entrances.", "Any visible year counts; just get it in the photo."]}'::jsonb, 13, 16,
    2, 4, false, 'location_specific', 'campus', ARRAY['college_campus_v1']::text[], 5, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 2, 'Money keeps a school alive. The building that runs this place carries the name of the businessman who kept the academy afloat in its leanest years.', '["It''s the administration building, close to the Maeser Building.", "Students just call it by three letters.", "The ASB: Abraham O. Smoot Building."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('East-facing view of Y Mountain', 40.2499, -111.648, 'SRID=4326;POINT(-111.648 40.2499)', 50, 'campus', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  INSERT INTO public.primers (title, content, subject_domain, grade_range_min, grade_range_max, is_library,
    location_dependency, location_type, difficulty_rating, tags, estimated_minutes, created_by)
  VALUES ('The letter on the hill', '{"text": "Students built the Y on the mountain east of campus in 1906, hauling materials up by hand. It''s roughly 380 feet tall, far bigger than it looks from here, and it has been rebuilt and whitewashed many times since.", "items": ["Built by students in 1906", "About 380 feet tall"]}'::jsonb, 'history_community', 13, 16, false,
    'location_specific', 'campus', 3, ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_primer;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Count back', 'history_community', 'multiple_choice', '{"question": "The Y went up in 1906. How many years after the academy''s founding was that?", "options": ["21", "28", "31", "41"], "correct_answer": "31", "hints": ["The founding year is from your first stop.", "1906 minus the founding year.", "1906 - 1875."]}'::jsonb, 13, 16,
    2, 3, false, 'location_specific', 'campus', ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 3, 'Look up and east. The biggest letter in Utah County has been on that mountainside since students carried it up there on their backs.', '["Head to the east edge of upper campus.", "Any spot with a clear line of sight to the mountain works.", "You''re looking for the Y on Y Mountain."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Harold B. Lee Library', 40.2487, -111.6495, 'SRID=4326;POINT(-111.6495 40.2487)', 40, 'campus', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  v_primer := NULL;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Close the file', 'history_community', 'sorting_ordering', '{"question": "Put the archivist''s notes back in order, earliest first.", "items": ["Brigham Young Academy is founded", "Karl G. Maeser takes charge as principal", "The academy is renamed Brigham Young University", "Students build the Y on the mountain", "The Maeser Building is finished"], "correct_order": ["Brigham Young Academy is founded", "Karl G. Maeser takes charge as principal", "The academy is renamed Brigham Young University", "Students build the Y on the mountain", "The Maeser Building is finished"], "hints": ["You collected every one of these dates along the way.", "Two happen in the 1870s, three in the 1900s.", "1875, 1876, 1903, 1906, 1911."]}'::jsonb, 13, 16,
    3, 5, false, 'location_specific', 'campus', ARRAY['college_campus_v1']::text[], 3, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 4, 'Close the file where everyone on campus eventually ends up at 11 p.m.: the library at the center of upper campus.', '["It''s the biggest building near Brigham Square.", "Most of it is underground.", "The HBLL."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  -- ── Field Notes: Campus Ecology ──
  INSERT INTO public.hunts (title, description, target_audience, play_mode, identity_mode, status, is_public,
    center_latitude, center_longitude, search_radius_km, estimated_duration_min, grade_range_min, grade_range_max,
    subject_domains, theme, theme_narrative, difficulty_progression, metadata, created_by)
  VALUES ('Field Notes: Campus Ecology', 'Campus is a working ecosystem hiding in plain sight. Read a pond, track some birds, take a surface temperature, and connect it all to the ancient lake this whole valley used to be.', 'adults', 'solo', 'codename_assigned', 'draft', true,
    40.2492, -111.651, 1, 45, 13, 16,
    ARRAY['science_nature', 'geography_maps']::text[], 'Field biologist on assignment', 'You''re filing field notes for a survey of campus ecology. Each stop is one observation plus one idea that explains it.', 'mixed', '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_hunt;

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Botany Pond', 40.2485, -111.6512, 'SRID=4326;POINT(-111.6512 40.2485)', 30, 'water', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  INSERT INTO public.primers (title, content, subject_domain, grade_range_min, grade_range_max, is_library,
    location_dependency, location_type, difficulty_rating, tags, estimated_minutes, created_by)
  VALUES ('Reading a pond', '{"text": "Ponds turn green when algae explode, usually because extra nitrogen and phosphorus wash in from fertilized lawns, gardens and storm drains. This is eutrophication. When the algae die and decompose, bacteria use up the dissolved oxygen, which can stress or kill fish.", "items": ["Excess nutrients feed algae blooms", "Common sources: fertilizer runoff and storm drains", "Decomposition depletes oxygen"]}'::jsonb, 'science_nature', 13, 16, false,
    'location_specific', 'water', 4, ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_primer;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Pea-soup pond', 'science_nature', 'multiple_choice', '{"question": "A campus pond turns pea-soup green every August. Which is the most likely driver?", "options": ["Nutrient runoff from fertilized lawns", "Too many fish in the pond", "Water that''s too cold", "Not enough sunlight"], "correct_answer": "Nutrient runoff from fertilized lawns", "hints": ["Algae need light, warmth and food.", "Think about what''s sprayed on the lawns around here.", "Nitrogen and phosphorus from fertilizer."]}'::jsonb, 13, 16,
    2, 4, false, 'location_specific', 'water', ARRAY['college_campus_v1']::text[], 3, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 0, 'A small pond with a big name: tucked by the life-sciences buildings and planted to be studied, not just admired.', '["West side of upper campus, near the science buildings.", "Look for water with deliberate plantings around it.", "Botany Pond."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Duck Pond', 40.251, -111.652, 'SRID=4326;POINT(-111.652 40.251)', 40, 'water', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  INSERT INTO public.primers (title, content, subject_domain, grade_range_min, grade_range_max, is_library,
    location_dependency, location_type, difficulty_rating, tags, estimated_minutes, created_by)
  VALUES ('Counting like a biologist', '{"text": "Field biologists use timed counts to compare sites: watch for a fixed time, count distinct species (not individuals), and note behavior. Repeated over seasons, simple counts reveal migration, nesting and the effect of human feeding.", "items": ["Fix the time window", "Count species, not individuals", "Record behavior, not just presence"]}'::jsonb, 'science_nature', 13, 16, false,
    'location_specific', 'water', 3, ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_primer;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Three-minute survey', 'science_nature', 'numeric_entry', '{"question": "Set a 3-minute timer. How many distinct bird species can you identify here? (Can''t name them? Count clearly different kinds.)", "correct_answer": null, "hints": ["Look on the water, the banks and the trees.", "Mallards, geese, gulls and small songbirds all count separately.", "Any honest count completes this stop."], "unit": "species"}'::jsonb, 13, 16,
    2, 3, false, 'location_specific', 'water', ARRAY['college_campus_v1']::text[], 4, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 1, 'Follow the quacking. Campus has a second, larger pond where the wildlife has clearly figured out that students carry snacks.', '["North-west of upper campus.", "Bigger than Botany Pond, with lots of resident birds.", "The duck pond."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Benson Building garden', 40.2478, -111.6504, 'SRID=4326;POINT(-111.6504 40.2478)', 40, 'farm', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  INSERT INTO public.primers (title, content, subject_domain, grade_range_min, grade_range_max, is_library,
    location_dependency, location_type, difficulty_rating, tags, estimated_minutes, created_by)
  VALUES ('Why concrete runs hot', '{"text": "Dark, hard surfaces like asphalt absorb most sunlight (low albedo) and release it as heat; plants cool their surroundings by shading and by evaporating water. That combination is why cities, and big parking lots, run several degrees hotter than parks: the urban heat island effect.", "items": ["Low albedo = absorbs more sunlight", "Plants cool by shade and evapotranspiration", "Urban heat island: built areas run hotter"]}'::jsonb, 'science_nature', 13, 16, false,
    'location_specific', 'farm', 5, ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_primer;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Surface check', 'science_nature', 'short_text', '{"question": "Within 20 meters of you, find the hottest and coolest surfaces you can (carefully use the back of your hand). Name both and explain the difference using albedo, shade or evaporation.", "correct_answer": null, "hints": ["Compare something dark and paved with something planted.", "Shade and moisture both matter.", "Example: ''Asphalt was hottest (low albedo), the watered bed was coolest (evaporation).''"]}'::jsonb, 13, 16,
    3, 5, false, 'location_specific', 'farm', ARRAY['college_campus_v1']::text[], 5, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 2, 'Head for the building where plant and animal sciences live. The landscaping outside is doing more science than it lets on.', '["It''s the life-sciences building on the south-west side of campus.", "Look for planted beds outside the entrance.", "The Benson Building."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Monte L. Bean Life Science Museum', 40.2495, -111.6507, 'SRID=4326;POINT(-111.6507 40.2495)', 40, 'campus', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  INSERT INTO public.primers (title, content, subject_domain, grade_range_min, grade_range_max, is_library,
    location_dependency, location_type, difficulty_rating, tags, estimated_minutes, created_by)
  VALUES ('Utah Lake''s unwanted guest', '{"text": "Common carp were introduced to Utah Lake over a century ago and now make up most of its fish biomass. Carp feed by rooting through the lakebed, uprooting plants and clouding the water. The native June sucker, found nowhere else, crashed toward extinction as its habitat degraded, and large-scale carp removal is part of its recovery plan.", "items": ["Carp introduced 1800s; now dominant", "Feeding uproots plants and muddies water", "June sucker: native, endangered, recovering"]}'::jsonb, 'science_nature', 13, 16, false,
    'location_specific', 'campus', 5, ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_primer;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Invasion mechanics', 'science_nature', 'multiple_choice', '{"question": "How did introduced carp hurt Utah Lake''s native June sucker the most?", "options": ["By destroying habitat: uprooting plants and muddying the water", "By eating adult June suckers", "By raising the lake''s temperature", "By making the water saltier"], "correct_answer": "By destroying habitat: uprooting plants and muddying the water", "hints": ["The primer describes how carp feed.", "Think habitat, not predation.", "Rooting through the lakebed has consequences."]}'::jsonb, 13, 16,
    3, 5, false, 'location_specific', 'campus', ARRAY['college_campus_v1']::text[], 3, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 3, 'Find the building full of animals that hold very still. Free entry, lots of taxidermy, and the best case for Utah biodiversity on campus.', '["It''s a museum, not a classroom building.", "Look for the natural-history museum on the north side of campus.", "The Bean Life Science Museum."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('West-facing view of Utah Lake', 40.248, -111.6535, 'SRID=4326;POINT(-111.6535 40.248)', 60, 'campus', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  INSERT INTO public.primers (title, content, subject_domain, grade_range_min, grade_range_max, is_library,
    location_dependency, location_type, difficulty_rating, tags, estimated_minutes, created_by)
  VALUES ('You''re standing on a beach', '{"text": "About 15,000 to 30,000 years ago, Lake Bonneville covered much of western Utah. As it drained and dried, it left shoreline terraces (benches) along the mountains, including one named after Provo. Utah Lake and the Great Salt Lake are what''s left of it.", "items": ["Lake Bonneville: Ice Age lake across western Utah", "Benches are old shorelines", "The ''Provo shoreline'' is named after this city"]}'::jsonb, 'geography_maps', 13, 16, false,
    'location_specific', 'campus', 3, ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_primer;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Ancient lake', 'geography_maps', 'multiple_choice', '{"question": "Utah Lake is a remnant of which Ice Age lake?", "options": ["Lake Bonneville", "Lake Lahontan", "Lake Missoula", "Lake Agassiz"], "correct_answer": "Lake Bonneville", "hints": ["It''s named in the primer.", "It also left the Great Salt Lake behind.", "Same name as the famous salt flats."]}'::jsonb, 13, 16,
    2, 3, false, 'location_specific', 'campus', ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 4, 'End with the long view: find a spot on the west side of campus where you can see the lake and the valley floor below.', '["Head to the west edge of campus.", "You want a clear view toward the water.", "Utah Lake is the big, flat water to the west."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  -- ── Campus by the Numbers ──
  INSERT INTO public.hunts (title, description, target_audience, play_mode, identity_mode, status, is_public,
    center_latitude, center_longitude, search_radius_km, estimated_duration_min, grade_range_min, grade_range_max,
    subject_domains, theme, theme_narrative, difficulty_progression, metadata, created_by)
  VALUES ('Campus by the Numbers', 'Pace it, estimate it, calculate it. A Fermi-estimation tour of campus for people who''d rather reason to an answer than look it up.', 'adults', 'solo', 'codename_assigned', 'draft', true,
    40.249, -111.649, 1, 40, 13, 16,
    ARRAY['math_real_world', 'critical_thinking']::text[], 'Back-of-the-envelope', 'Every stop is a question you could Google, but you''ll get closer, faster, by estimating. Bring your stride and a phone calculator.', 'ascending', '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_hunt;

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Brigham Square', 40.2497, -111.6493, 'SRID=4326;POINT(-111.6493 40.2497)', 35, 'campus', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  INSERT INTO public.primers (title, content, subject_domain, grade_range_min, grade_range_max, is_library,
    location_dependency, location_type, difficulty_rating, tags, estimated_minutes, created_by)
  VALUES ('Fermi estimation', '{"text": "Fermi estimates break a hard question into rough pieces you can measure or guess, then multiply. An average walking stride is about 0.75 m. A packed concert crowd is about 4 people per square meter; a comfortable crowd is closer to 1.", "items": ["One stride is about 0.75 m", "Packed crowd: ~4 people/m²", "Comfortable crowd: ~1 person/m²"]}'::jsonb, 'math_real_world', 13, 16, false,
    'location_specific', 'campus', 4, ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_primer;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Crowd capacity', 'math_real_world', 'numeric_entry', '{"question": "Pace off the plaza''s length and width. At concert density (about 4 people per m²), roughly how many people could fit here?", "correct_answer": null, "hints": ["Count strides each way, multiply by 0.75 to get meters.", "Area = length × width.", "Multiply the area by 4."], "unit": "people"}'::jsonb, 13, 16,
    2, 4, false, 'location_specific', 'campus', ARRAY['college_campus_v1']::text[], 5, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 0, 'Start in the biggest open plaza on upper campus. You''ll be measuring it with your feet.', '["Central upper campus.", "Between the library and the oldest buildings.", "Brigham Square."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Harold B. Lee Library', 40.2487, -111.6495, 'SRID=4326;POINT(-111.6495 40.2487)', 40, 'campus', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  v_primer := NULL;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Shelf math', 'math_real_world', 'multiple_choice', '{"question": "A typical library shelf holds about 30 books per meter. A library with 100 km of shelving holds roughly how many books?", "options": ["300,000", "3 million", "30 million", "300 million"], "correct_answer": "3 million", "hints": ["Convert kilometers to meters first.", "100 km = 100,000 m.", "100,000 × 30."]}'::jsonb, 13, 16,
    2, 4, false, 'location_specific', 'campus', ARRAY['college_campus_v1']::text[], 3, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 1, 'Next: the building where most of the campus''s square footage is hiding underground.', '["Right next to the square.", "Most of it is below ground level.", "The HBLL."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('East-facing view of Y Mountain', 40.2499, -111.648, 'SRID=4326;POINT(-111.648 40.2499)', 50, 'campus', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  INSERT INTO public.primers (title, content, subject_domain, grade_range_min, grade_range_max, is_library,
    location_dependency, location_type, difficulty_rating, tags, estimated_minutes, created_by)
  VALUES ('Grade, not angle', '{"text": "Trail steepness is usually given as grade: vertical rise divided by horizontal distance, as a percentage. A 10% grade rises 10 feet for every 100 feet traveled. One mile is 5,280 feet.", "items": ["Grade = rise ÷ run × 100%", "1 mile = 5,280 ft"]}'::jsonb, 'math_real_world', 13, 16, false,
    'location_specific', 'campus', 6, ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_primer;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('How steep is the Y?', 'math_real_world', 'multiple_choice', '{"question": "The Y trail climbs about 1,070 feet over roughly 1.2 miles. What''s its average grade?", "options": ["About 9%", "About 17%", "About 34%", "About 89%"], "correct_answer": "About 17%", "hints": ["Convert 1.2 miles to feet.", "1.2 × 5,280 = 6,336 ft.", "1,070 ÷ 6,336 ≈ 0.17."]}'::jsonb, 13, 16,
    3, 6, false, 'location_specific', 'campus', ARRAY['college_campus_v1']::text[], 3, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 2, 'Find a clear line of sight to the giant letter on the mountain. You''re about to find out how steep the hike to it is.', '["East edge of upper campus.", "Look up and east.", "The Y on Y Mountain."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Eyring Science Center', 40.2493, -111.6478, 'SRID=4326;POINT(-111.6478 40.2493)', 40, 'campus', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  INSERT INTO public.primers (title, content, subject_domain, grade_range_min, grade_range_max, is_library,
    location_dependency, location_type, difficulty_rating, tags, estimated_minutes, created_by)
  VALUES ('Similar triangles', '{"text": "At any moment, the sun hits everything nearby at the same angle, so the ratio of height to shadow is the same for you and for a lamppost. If you know your height and measure both shadows, the lamppost''s height = your height × (its shadow ÷ your shadow).", "items": ["Same sun angle means same height-to-shadow ratio", "Height = your height × (its shadow ÷ your shadow)"]}'::jsonb, 'math_real_world', 13, 16, false,
    'location_specific', 'campus', 6, ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_primer;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Shadow measurement', 'math_real_world', 'numeric_entry', '{"question": "Pick a lamppost, sign or tree near this building. Pace off its shadow and your own. Using your height, estimate its height in meters. (Overcast? Estimate by stacking your own height instead.)", "correct_answer": null, "hints": ["Measure both shadows the same way, e.g. in shoe lengths.", "Height = your height × (its shadow ÷ your shadow).", "Any reasoned estimate completes this stop."], "unit": "m"}'::jsonb, 13, 16,
    3, 6, false, 'location_specific', 'campus', ARRAY['college_campus_v1']::text[], 5, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 3, 'Head to the physics building. You''ll be measuring something tall without climbing it.', '["East side of upper campus.", "It''s where physics and astronomy live.", "The Eyring Science Center."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Joseph F. Smith Building', 40.247, -111.6492, 'SRID=4326;POINT(-111.6492 40.247)', 40, 'campus', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  v_primer := NULL;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Late to class', 'math_real_world', 'multiple_choice', '{"question": "Walking speed is about 5 km/h. If your next class is 1.5 km away, about how many minutes do you need?", "options": ["8 minutes", "18 minutes", "30 minutes", "45 minutes"], "correct_answer": "18 minutes", "hints": ["Time = distance ÷ speed.", "1.5 ÷ 5 = 0.3 hours.", "0.3 hours × 60 minutes."]}'::jsonb, 13, 16,
    2, 3, false, 'location_specific', 'campus', ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 4, 'Finish at the big glass-and-brick home of the humanities and family sciences, south of the library.', '["South of the HBLL.", "Large atrium, lots of glass.", "The JFSB."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  -- ── Read the Room: Art & Argument ──
  INSERT INTO public.hunts (title, description, target_audience, play_mode, identity_mode, status, is_public,
    center_latitude, center_longitude, search_radius_km, estimated_duration_min, grade_range_min, grade_range_max,
    subject_domains, theme, theme_narrative, difficulty_progression, metadata, created_by)
  VALUES ('Read the Room: Art & Argument', 'A walking seminar in noticing, persuading and spotting bad arguments, using campus art and architecture as the source material.', 'adults', 'solo', 'codename_assigned', 'draft', true,
    40.2482, -111.6505, 1, 40, 13, 16,
    ARRAY['reading_writing', 'critical_thinking']::text[], 'Critic at large', 'You''re writing a short critic''s notebook: a few lines on what you see, and a sharper eye for how people try to convince you of things.', 'mixed', '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_hunt;

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Museum of Art entrance', 40.2478, -111.654, 'SRID=4326;POINT(-111.654 40.2478)', 40, 'campus', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  INSERT INTO public.primers (title, content, subject_domain, grade_range_min, grade_range_max, is_library,
    location_dependency, location_type, difficulty_rating, tags, estimated_minutes, created_by)
  VALUES ('Constraint makes it sharper', '{"text": "Six-word stories, like the one often attributed to Hemingway (''For sale: baby shoes, never worn''), work by implying a bigger story than they tell. Constraints force you to choose the single detail that does the most work.", "items": ["Imply more than you state", "Pick the one detail that does the most work"]}'::jsonb, 'reading_writing', 13, 16, false,
    'location_specific', 'campus', 4, ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_primer;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Six words', 'reading_writing', 'creative_writing', '{"question": "Look around the entrance and plaza. Write a six-word story inspired by something you can see right now.", "correct_answer": null, "hints": ["Pick one concrete detail, not the whole scene.", "Suggest what happened before or after.", "Count: exactly six words."]}'::jsonb, 13, 16,
    2, 4, false, 'location_specific', 'campus', ARRAY['college_campus_v1']::text[], 4, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 0, 'Start at campus''s dedicated art museum: big, modern, free to enter, and usually hosting at least one exhibit people argue about.', '["It''s a standalone museum building, not inside a classroom building.", "Look for the large modern building with a broad front plaza.", "The Museum of Art (MOA)."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Outdoor sculpture on campus', 40.2485, -111.6515, 'SRID=4326;POINT(-111.6515 40.2485)', 80, 'campus', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  v_primer := NULL;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Read the plaque', 'reading_writing', 'short_text', '{"question": "Write the sculpture''s title and artist from the plaque, then one sentence on what you think the artist wanted a passerby to feel.", "correct_answer": null, "hints": ["Plaques are usually at the base or on a nearby post.", "Think about scale, material and where it was placed.", "Format: ''Title, Artist. I think it wants you to feel ___ because ___.''"]}'::jsonb, 13, 16,
    2, 4, false, 'location_specific', 'campus', ARRAY['college_campus_v1']::text[], 5, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 1, 'Campus has public sculpture scattered across it. Find any one piece, preferably one you''ve walked past a hundred times without reading the plaque.', '["Check plazas, building entrances and garden beds.", "Look for a plaque at the base.", "Any outdoor sculpture with a plaque works."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Harold B. Lee Library', 40.2487, -111.6495, 'SRID=4326;POINT(-111.6495 40.2487)', 40, 'campus', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  INSERT INTO public.primers (title, content, subject_domain, grade_range_min, grade_range_max, is_library,
    location_dependency, location_type, difficulty_rating, tags, estimated_minutes, created_by)
  VALUES ('Classic persuasion moves', '{"text": "Bandwagon appeals say everyone''s doing it. Appeals to authority lean on who''s saying it rather than the evidence. Scarcity says act now before it''s gone. None of these is automatically wrong, but each is a shortcut that can replace an actual reason.", "items": ["Bandwagon: everyone''s doing it", "Authority: trust who says it", "Scarcity: act before it''s gone"]}'::jsonb, 'critical_thinking', 13, 16, false,
    'location_specific', 'campus', 3, ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_primer;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Name the move', 'critical_thinking', 'multiple_choice', '{"question": "A flyer reads: ''Everyone''s switching to the new study rooms. Don''t get left behind!'' Which technique is it leaning on?", "options": ["Bandwagon", "Appeal to authority", "Scarcity", "Straw man"], "correct_answer": "Bandwagon", "hints": ["Which primer item is about what other people are doing?", "''Everyone''s switching...''", "It''s the bandwagon appeal."]}'::jsonb, 13, 16,
    2, 3, false, 'location_specific', 'campus', ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 2, 'Head to the building with the most posters per square meter on campus. Study the bulletin boards like a rhetorician.', '["Central upper campus.", "Big, mostly underground, very busy.", "The HBLL."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Joseph F. Smith Building', 40.247, -111.6492, 'SRID=4326;POINT(-111.6492 40.247)', 40, 'campus', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  INSERT INTO public.primers (title, content, subject_domain, grade_range_min, grade_range_max, is_library,
    location_dependency, location_type, difficulty_rating, tags, estimated_minutes, created_by)
  VALUES ('Attack the argument, not the person', '{"text": "An ad hominem fallacy dismisses a claim because of who made it rather than whether it''s true. A straw man misrepresents an opponent''s view to make it easier to knock down. Both are common in comment sections and campus debates alike.", "items": ["Ad hominem: attacks the speaker", "Straw man: distorts the opposing view"]}'::jsonb, 'critical_thinking', 13, 16, false,
    'location_specific', 'campus', 5, ARRAY['college_campus_v1']::text[], 2, v_owner)
  RETURNING id INTO v_primer;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Spot the fallacy', 'critical_thinking', 'multiple_choice', '{"question": "Which of these is an ad hominem?", "options": ["''You can''t trust her budget plan; she failed accounting once.''", "''If we extend library hours, students will have more time to study.''", "''Most surveyed students prefer later classes, so we should test it.''", "''This policy costs more, but it saves time.''"], "correct_answer": "''You can''t trust her budget plan; she failed accounting once.''", "hints": ["Which option ignores the plan itself?", "Look for the one about the person, not the idea.", "The accounting grade isn''t evidence about the budget."]}'::jsonb, 13, 16,
    3, 5, false, 'location_specific', 'campus', ARRAY['college_campus_v1']::text[], 3, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 3, 'Find the home of the humanities: the building where English, philosophy and history majors spend most of their week.', '["South of the library.", "Large central atrium.", "The JFSB."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);

  INSERT INTO public.locations (name, latitude, longitude, coordinates, radius_meters, location_type, is_library, metadata, created_by)
  VALUES ('Brigham Square', 40.2497, -111.6493, 'SRID=4326;POINT(-111.6493 40.2497)', 35, 'campus', false, '{"seed": "college_campus_v1"}'::jsonb, v_owner)
  RETURNING id INTO v_loc;
  v_primer := NULL;
  INSERT INTO public.tasks (title, subject_domain, challenge_type, content, grade_range_min, grade_range_max,
    difficulty_level, difficulty_rating, is_library, location_dependency, location_type, tags, estimated_minutes, created_by)
  VALUES ('Take a side', 'critical_thinking', 'short_text', '{"question": "Universities across the country have debated renaming buildings. In two sentences: should a campus ever change a building''s name? Give one reason, and name the strongest objection to your own view.", "correct_answer": null, "hints": ["Either side is fine; you''re graded on reasoning.", "Sentence one: claim plus reason. Sentence two: the best counterargument.", "Steelman the other side; don''t straw-man it."]}'::jsonb, 13, 16,
    3, 6, false, 'location_specific', 'campus', ARRAY['college_campus_v1']::text[], 4, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.finds (hunt_id, location_id, task_id, primer_id, sort_order, clue_text, clue_hints, hot_cold_enabled, scaffolding_level, metadata)
  VALUES (v_hunt, v_loc, v_task, v_primer, 4, 'End at the central plaza named after a founder, a fitting spot for the last question.', '["Central upper campus.", "Wide-open plaza between the library and the Maeser Building.", "Brigham Square."]'::jsonb, true, 'low', '{"needs_placement": true, "seed": "college_campus_v1"}'::jsonb);
END $$;

COMMIT;
