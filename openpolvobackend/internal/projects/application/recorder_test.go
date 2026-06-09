package application

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/projects/domain"
)

// fakeRepo é um ProjectRepository em memória para testar a lógica de aplicação.
type fakeRepo struct {
	projects map[uuid.UUID]*domain.Project
	versions map[uuid.UUID][]domain.ProjectVersion
	files    map[uuid.UUID][]domain.ProjectFile
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		projects: map[uuid.UUID]*domain.Project{},
		versions: map[uuid.UUID][]domain.ProjectVersion{},
		files:    map[uuid.UUID][]domain.ProjectFile{},
	}
}

func (r *fakeRepo) CreateProject(_ context.Context, p *domain.Project) error {
	cp := *p
	r.projects[p.ID] = &cp
	return nil
}

func (r *fakeRepo) GetProjectByConversation(_ context.Context, conversationID, userID uuid.UUID) (*domain.Project, error) {
	for _, p := range r.projects {
		if p.ConversationID == conversationID && p.UserID == userID {
			cp := *p
			return &cp, nil
		}
	}
	return nil, ErrNotFound
}

func (r *fakeRepo) GetProjectByID(_ context.Context, id, userID uuid.UUID) (*domain.Project, error) {
	if p, ok := r.projects[id]; ok && p.UserID == userID {
		cp := *p
		return &cp, nil
	}
	return nil, ErrNotFound
}

func (r *fakeRepo) ListProjectsByUser(_ context.Context, userID uuid.UUID) ([]domain.Project, error) {
	var out []domain.Project
	for _, p := range r.projects {
		if p.UserID == userID {
			out = append(out, *p)
		}
	}
	return out, nil
}

func (r *fakeRepo) SaveVersion(_ context.Context, v *domain.ProjectVersion, files []domain.ProjectFile) error {
	r.versions[v.ProjectID] = append(r.versions[v.ProjectID], *v)
	r.files[v.ID] = append([]domain.ProjectFile(nil), files...)
	if p, ok := r.projects[v.ProjectID]; ok {
		p.LatestVersionSeq = v.Seq
		p.UpdatedAt = v.CreatedAt
	}
	return nil
}

func (r *fakeRepo) ListVersions(_ context.Context, projectID uuid.UUID) ([]domain.ProjectVersion, error) {
	return r.versions[projectID], nil
}

func (r *fakeRepo) GetVersionBySeq(_ context.Context, projectID uuid.UUID, seq int) (*domain.ProjectVersion, error) {
	for _, v := range r.versions[projectID] {
		if v.Seq == seq {
			cp := v
			return &cp, nil
		}
	}
	return nil, ErrNotFound
}

func (r *fakeRepo) GetLatestVersion(_ context.Context, projectID uuid.UUID) (*domain.ProjectVersion, error) {
	list := r.versions[projectID]
	if len(list) == 0 {
		return nil, ErrNotFound
	}
	latest := list[0]
	for _, v := range list[1:] {
		if v.Seq > latest.Seq {
			latest = v
		}
	}
	cp := latest
	return &cp, nil
}

func (r *fakeRepo) GetFilesByVersion(_ context.Context, versionID uuid.UUID) ([]domain.ProjectFile, error) {
	return r.files[versionID], nil
}

func newRecorder(repo *fakeRepo) *Recorder {
	return &Recorder{
		Ensure: &EnsureProjectForConversation{Repo: repo},
		Save:   &SaveProjectVersion{Repo: repo},
		Repo:   repo,
	}
}

func TestRecorderPrefersProjectFiles(t *testing.T) {
	repo := newFakeRepo()
	rec := newRecorder(repo)
	userID, convID := uuid.New(), uuid.New()

	meta := map[string]any{
		"dev_workflow": map[string]any{"request_kind": "new_app"},
		"dev_studio_context": map[string]any{
			"project_files": map[string]any{
				"src/App.tsx": "export default function App(){return null}",
			},
		},
	}
	if err := rec.RecordFromAssistantMessage(context.Background(), userID, convID, "Criei o teu app.", meta); err != nil {
		t.Fatalf("record: %v", err)
	}

	p, err := repo.GetProjectByConversation(context.Background(), convID, userID)
	if err != nil {
		t.Fatalf("get project: %v", err)
	}
	if p.Kind != "new_app" {
		t.Fatalf("kind = %q, want new_app", p.Kind)
	}
	if p.Stack != domain.DefaultStack {
		t.Fatalf("stack = %q, want %q", p.Stack, domain.DefaultStack)
	}
	if p.LatestVersionSeq != 1 {
		t.Fatalf("latest seq = %d, want 1", p.LatestVersionSeq)
	}
	latest, _ := repo.GetLatestVersion(context.Background(), p.ID)
	files, _ := repo.GetFilesByVersion(context.Background(), latest.ID)
	if len(files) != 1 || files[0].Path != "src/App.tsx" {
		t.Fatalf("unexpected files: %+v", files)
	}
	if latest.Summary != "Criei o teu app." {
		t.Fatalf("summary = %q", latest.Summary)
	}
}

func TestRecorderAppliesOpsOverPreviousVersion(t *testing.T) {
	repo := newFakeRepo()
	rec := newRecorder(repo)
	userID, convID := uuid.New(), uuid.New()

	first := map[string]any{
		"dev_studio_context": map[string]any{
			"project_files": map[string]any{
				"src/a.ts": "v1",
				"src/b.ts": "keep",
			},
		},
	}
	if err := rec.RecordFromAssistantMessage(context.Background(), userID, convID, "primeira", first); err != nil {
		t.Fatalf("record first: %v", err)
	}

	second := map[string]any{
		"polvo_code_ops": []any{
			map[string]any{"op": "write", "path": "src/a.ts", "content": "v2"},
			map[string]any{"op": "mkdir", "path": "src/dir"},
		},
	}
	if err := rec.RecordFromAssistantMessage(context.Background(), userID, convID, "segunda", second); err != nil {
		t.Fatalf("record second: %v", err)
	}

	p, _ := repo.GetProjectByConversation(context.Background(), convID, userID)
	if p.LatestVersionSeq != 2 {
		t.Fatalf("latest seq = %d, want 2", p.LatestVersionSeq)
	}
	latest, _ := repo.GetLatestVersion(context.Background(), p.ID)
	files, _ := repo.GetFilesByVersion(context.Background(), latest.ID)
	got := map[string]string{}
	for _, f := range files {
		got[f.Path] = f.Content
	}
	if got["src/a.ts"] != "v2" {
		t.Fatalf("src/a.ts = %q, want v2 (op write should override)", got["src/a.ts"])
	}
	if got["src/b.ts"] != "keep" {
		t.Fatalf("src/b.ts = %q, want keep (previous file should carry over)", got["src/b.ts"])
	}
	if _, ok := got["src/dir"]; ok {
		t.Fatalf("mkdir op should not create a file")
	}
}

func TestRecorderNoopWithoutDevMetadata(t *testing.T) {
	repo := newFakeRepo()
	rec := newRecorder(repo)
	if err := rec.RecordFromAssistantMessage(context.Background(), uuid.New(), uuid.New(), "olá", map[string]any{"intent": "chat"}); err != nil {
		t.Fatalf("record: %v", err)
	}
	if len(repo.projects) != 0 {
		t.Fatalf("expected no project persisted, got %d", len(repo.projects))
	}
}

func TestRollbackCreatesNewVersionFromTarget(t *testing.T) {
	repo := newFakeRepo()
	rec := newRecorder(repo)
	userID, convID := uuid.New(), uuid.New()

	v1 := map[string]any{"dev_studio_context": map[string]any{"project_files": map[string]any{"f": "one"}}}
	if err := rec.RecordFromAssistantMessage(context.Background(), userID, convID, "v1", v1); err != nil {
		t.Fatalf("v1: %v", err)
	}
	v2 := map[string]any{"dev_studio_context": map[string]any{"project_files": map[string]any{"f": "two"}}}
	if err := rec.RecordFromAssistantMessage(context.Background(), userID, convID, "v2", v2); err != nil {
		t.Fatalf("v2: %v", err)
	}
	p, _ := repo.GetProjectByConversation(context.Background(), convID, userID)

	rb := &RollbackToVersion{Repo: repo}
	out, files, err := rb.Execute(context.Background(), p.ID, userID, 1)
	if err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if out.LatestVersionSeq != 3 {
		t.Fatalf("latest seq = %d, want 3 (rollback creates new version)", out.LatestVersionSeq)
	}
	if len(files) != 1 || files[0].Content != "one" {
		t.Fatalf("rollback files = %+v, want content of seq 1", files)
	}
}

func TestRollbackUnknownSeqReturnsNotFound(t *testing.T) {
	repo := newFakeRepo()
	rec := newRecorder(repo)
	userID, convID := uuid.New(), uuid.New()
	v1 := map[string]any{"dev_studio_context": map[string]any{"project_files": map[string]any{"f": "one"}}}
	if err := rec.RecordFromAssistantMessage(context.Background(), userID, convID, "v1", v1); err != nil {
		t.Fatalf("v1: %v", err)
	}
	p, _ := repo.GetProjectByConversation(context.Background(), convID, userID)
	rb := &RollbackToVersion{Repo: repo}
	if _, _, err := rb.Execute(context.Background(), p.ID, userID, 99); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}
