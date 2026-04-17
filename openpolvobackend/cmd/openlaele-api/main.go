package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/open-polvo/open-polvo/internal/agent/adapters/polvointel"
	agapp "github.com/open-polvo/open-polvo/internal/agent/application"
	agentports "github.com/open-polvo/open-polvo/internal/agent/ports"
	convmysql "github.com/open-polvo/open-polvo/internal/conversations/adapters/mysql"
	convapp "github.com/open-polvo/open-polvo/internal/conversations/application"
	"github.com/open-polvo/open-polvo/internal/conversations/domain"
	contactsmysql "github.com/open-polvo/open-polvo/internal/contacts/adapters/mysql"
	contactsapp "github.com/open-polvo/open-polvo/internal/contacts/application"
	bcryptadapter "github.com/open-polvo/open-polvo/internal/identity/adapters/bcrypt"
	jwtissuer "github.com/open-polvo/open-polvo/internal/identity/adapters/jwtissuer"
	idmysql "github.com/open-polvo/open-polvo/internal/identity/adapters/mysql"
	idapp "github.com/open-polvo/open-polvo/internal/identity/application"
	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
	platformdb "github.com/open-polvo/open-polvo/internal/platform/db"
	platformmigrate "github.com/open-polvo/open-polvo/internal/platform/migrate"
	mailmysql "github.com/open-polvo/open-polvo/internal/mail/adapters/mysql"
	mailapp "github.com/open-polvo/open-polvo/internal/mail/application"
	tasklistsmysql "github.com/open-polvo/open-polvo/internal/tasklists/adapters/mysql"
	tasklistsintel "github.com/open-polvo/open-polvo/internal/tasklists/adapters/polvointel"
	taskapp "github.com/open-polvo/open-polvo/internal/tasklists/application"
	tasklistsports "github.com/open-polvo/open-polvo/internal/tasklists/ports"
	httptransport "github.com/open-polvo/open-polvo/internal/transport/http"
	wfmysql "github.com/open-polvo/open-polvo/internal/workflows/adapters/mysql"
	wfapp "github.com/open-polvo/open-polvo/internal/workflows/application"
	wfports "github.com/open-polvo/open-polvo/internal/workflows/ports"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(log)

	cfg, err := platformcfg.Load()
	if err != nil {
		slog.Error("config", "err", err)
		os.Exit(1)
	}

	db, err := platformdb.Open(cfg.MYSQLDSN)
	if err != nil {
		slog.Error("db open", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	// Recuperação única: migração 000002 falhou com dois CREATE no mesmo ficheiro (dirty v2).
	if strings.EqualFold(strings.TrimSpace(os.Getenv("FIX_SCHEMA_MIGRATIONS_DIRTY_V2")), "true") {
		res, err := db.ExecContext(context.Background(),
			`UPDATE schema_migrations SET dirty = 0 WHERE version = 2 AND dirty = 1`)
		if err != nil {
			slog.Warn("FIX_SCHEMA_MIGRATIONS_DIRTY_V2", "err", err)
		} else {
			n, _ := res.RowsAffected()
			if n > 0 {
				slog.Info("schema_migrations: cleared dirty on version 2 (remove FIX_SCHEMA_MIGRATIONS_DIRTY_V2 from .env after sucesso)")
			}
		}
	}
	// Recuperação: migração 000004 falhou com dois ALTER no mesmo ficheiro (migrate envia um statement; MySQL 1064) → dirty v4.
	if strings.EqualFold(strings.TrimSpace(os.Getenv("FIX_SCHEMA_MIGRATIONS_DIRTY_V4")), "true") {
		ctx4 := context.Background()
		var colCount int
		_ = db.QueryRowContext(ctx4,
			`SELECT COUNT(*) FROM information_schema.COLUMNS
			 WHERE TABLE_SCHEMA = DATABASE()
			   AND TABLE_NAME   = 'laele_conversations'
			   AND COLUMN_NAME  IN ('deleted_at', 'pinned_at')`).Scan(&colCount)

		if colCount < 2 {
			if _, err := db.ExecContext(ctx4,
				`DELETE FROM schema_migrations WHERE version = 4`); err != nil {
				slog.Warn("FIX_SCHEMA_MIGRATIONS_DIRTY_V4: apagar v4 falhou", "err", err)
			} else {
				slog.Info("FIX_SCHEMA_MIGRATIONS_DIRTY_V4: registo v4 apagado — migration corrigida será aplicada no arranque (remova FIX_SCHEMA_MIGRATIONS_DIRTY_V4 do .env após sucesso)")
			}
		} else {
			res, err := db.ExecContext(ctx4,
				`UPDATE schema_migrations SET dirty = 0 WHERE version = 4 AND dirty = 1`)
			if err != nil {
				slog.Warn("FIX_SCHEMA_MIGRATIONS_DIRTY_V4: limpar dirty falhou", "err", err)
			} else {
				n, _ := res.RowsAffected()
				if n > 0 {
					slog.Info("FIX_SCHEMA_MIGRATIONS_DIRTY_V4: dirty v4 limpo (colunas já existiam; remova FIX_SCHEMA_MIGRATIONS_DIRTY_V4 do .env)")
				}
			}
		}
	}
	// Recuperação: migração 000007 pode falhar em ambientes onde a coluna já existe → dirty v7.
	if strings.EqualFold(strings.TrimSpace(os.Getenv("FIX_SCHEMA_MIGRATIONS_DIRTY_V7")), "true") {
		ctx7 := context.Background()
		var n int
		_ = db.QueryRowContext(ctx7,
			`SELECT COUNT(*) FROM information_schema.COLUMNS
			 WHERE TABLE_SCHEMA = DATABASE()
			   AND TABLE_NAME   = 'laele_workflows'
			   AND COLUMN_NAME  = 'pinned_at'`).Scan(&n)
		if n > 0 {
			res, err := db.ExecContext(ctx7,
				`UPDATE schema_migrations SET dirty = 0 WHERE version = 7 AND dirty = 1`)
			if err != nil {
				slog.Warn("FIX_SCHEMA_MIGRATIONS_DIRTY_V7: limpar dirty falhou", "err", err)
			} else {
				ra, _ := res.RowsAffected()
				if ra > 0 {
					slog.Info("FIX_SCHEMA_MIGRATIONS_DIRTY_V7: dirty v7 limpo (coluna já existia; remova FIX_SCHEMA_MIGRATIONS_DIRTY_V7 do .env)")
				}
			}
		}
	}
	// Recuperação: migração 000012 pode ficar dirty se ADD COLUMN falhou depois da coluna já existir (re-execução).
	if strings.EqualFold(strings.TrimSpace(os.Getenv("FIX_SCHEMA_MIGRATIONS_DIRTY_V12")), "true") {
		ctx12 := context.Background()
		var n12 int
		_ = db.QueryRowContext(ctx12,
			`SELECT COUNT(*) FROM information_schema.COLUMNS
			 WHERE TABLE_SCHEMA = DATABASE()
			   AND TABLE_NAME   = 'laele_user_smtp_settings'
			   AND COLUMN_NAME  = 'email_chat_skip_confirmation'`).Scan(&n12)
		if n12 > 0 {
			res, err := db.ExecContext(ctx12,
				`UPDATE schema_migrations SET dirty = 0 WHERE version = 12 AND dirty = 1`)
			if err != nil {
				slog.Warn("FIX_SCHEMA_MIGRATIONS_DIRTY_V12: limpar dirty falhou", "err", err)
			} else {
				ra, _ := res.RowsAffected()
				if ra > 0 {
					slog.Info("FIX_SCHEMA_MIGRATIONS_DIRTY_V12: dirty v12 limpo (coluna já existia; remova FIX_SCHEMA_MIGRATIONS_DIRTY_V12 do .env)")
				}
			}
		}
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("FIX_SCHEMA_MIGRATIONS_REAPPLY_FROM_V2")), "true") {
		var n int
		_ = db.QueryRowContext(context.Background(),
			`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'laele_conversations'`).Scan(&n)
		if n == 0 {
			if _, err := db.ExecContext(context.Background(), `DELETE FROM schema_migrations WHERE version >= 2`); err != nil {
				slog.Warn("FIX_SCHEMA_MIGRATIONS_REAPPLY_FROM_V2", "err", err)
			} else {
				slog.Info("schema_migrations: removed version >= 2 (laele_conversations em falta; remova FIX_SCHEMA_MIGRATIONS_REAPPLY_FROM_V2 após sucesso)")
			}
		}
	}

	if cfg.RunMigrations {
		migDir, err := platformmigrate.ResolveMigrationsDir(cfg.MigrationsPath)
		if err != nil {
			slog.Error("migrations path", "err", err)
			os.Exit(1)
		}
		slog.Info("running database migrations", "dir", migDir)
		if err := platformmigrate.Apply(cfg.MYSQLDSN, migDir); err != nil {
			slog.Error("migrations", "err", err)
			os.Exit(1)
		}
		slog.Info("database migrations applied")
	}

	userRepo := idmysql.UserRepository{DB: db}
	hasher := bcryptadapter.Hasher{}

	if cfg.BootstrapDefaultAdmin {
		boot := idapp.DefaultAdminBootstrap{Users: userRepo, Hasher: hasher}
		created, err := boot.Ensure(context.Background(), cfg.DefaultAdminEmail, cfg.DefaultAdminPassword)
		if err != nil {
			slog.Error("bootstrap default admin", "err", err)
			os.Exit(1)
		}
		if created {
			slog.Warn("utilizador admin por defeito criado; altere DEFAULT_ADMIN_PASSWORD em produção",
				"email", cfg.DefaultAdminEmail)
		}
	}

	issuer := jwtissuer.Issuer{
		Secret: []byte(cfg.JWTSecret),
		Issuer: cfg.JWTIssuer,
		TTL:    cfg.JWTAccessTTL,
	}

	loginUC := &idapp.Login{
		Users:  userRepo,
		Hasher: hasher,
		Tokens: issuer,
	}
	registerUC := &idapp.Register{
		Users:  userRepo,
		Hasher: hasher,
		Tokens: issuer,
	}

	intel := polvointel.New(
		cfg.PolvoIntelligenceBaseURL,
		cfg.PolvoIntelligenceInternalKey,
		cfg.AgentLLMTimeout,
	)
	var chatOrch agentports.ChatOrchestrator
	if intel != nil {
		chatOrch = intel
	} else {
		slog.Warn("Open Polvo Intelligence not configured (POLVO_INTELLIGENCE_BASE_URL + POLVO_INTELLIGENCE_INTERNAL_KEY)")
	}

	statusUC := &agapp.CheckAgentStatus{Client: intel}
	localThreadUC := agapp.CreateLocalThread{}

	authH := &httptransport.AuthHandlers{
		Login:         loginUC,
		Register:      registerUC,
		AllowRegister: cfg.AuthAllowRegister,
		Users:         userRepo,
		Parser:        issuer,
	}
	agentH := &httptransport.AgentHandlers{
		Status:       statusUC,
		CreateThread: &localThreadUC,
	}

	convRepo := convmysql.ConversationRepository{DB: db}
	msgRepo := convmysql.MessageRepository{DB: db}
	createConvUC := &convapp.CreateConversation{
		Conversations: convRepo,
	}
	smtpRepo := &mailmysql.SMTPSettingsRepository{DB: db}
	smtpLoader := &mailapp.SMTPContextLoader{Repo: smtpRepo}
	contactRepo := &contactsmysql.ContactRepository{DB: db}
	contactsReply := &contactsapp.ContactsReplyLoader{Repo: contactRepo}
	getContactUC := &contactsapp.GetContact{Repo: contactRepo}
	sendMsgUC := &convapp.SendMessage{
		Conversations: convRepo,
		Messages:      msgRepo,
		Agent:         chatOrch,
		SMTPForReply:  smtpLoader.ForReply,
		ContactsForReply: func(ctx context.Context, userID uuid.UUID) []agentports.ContactBrief {
			return contactsReply.ForReply(ctx, userID)
		},
	}
	sendMailUC := &mailapp.SendUserEmail{Repo: smtpRepo, Cfg: cfg}
	mailHandlers := &httptransport.MailHandlers{
		GetSMTP:    &mailapp.GetMySMTP{Repo: smtpRepo},
		PutSMTP:    &mailapp.PutMySMTP{Repo: smtpRepo, Cfg: cfg},
		Send:       sendMailUC,
		TestSMTP:   &mailapp.TestSMTPConnection{Repo: smtpRepo, Cfg: cfg},
		GetContact: getContactUC,
	}
	contactHandlers := &httptransport.ContactHandlers{
		List:      &contactsapp.ListContacts{Repo: contactRepo},
		Create:    &contactsapp.CreateContact{Repo: contactRepo},
		Get:       getContactUC,
		Update:    &contactsapp.UpdateContact{Repo: contactRepo},
		DeleteOne: &contactsapp.DeleteContact{Repo: contactRepo},
	}
	var wfHandlers *httptransport.WorkflowHandlers
	wfRepo := wfmysql.WorkflowRepository{DB: db}
	runRepo := wfmysql.RunRepository{DB: db}
	var wfLLM wfports.IntelligenceService
	if intel != nil {
		wfLLM = intel
	}
	createWF := &wfapp.CreateWorkflow{Workflows: wfRepo}
	runWfUC := &wfapp.RunWorkflow{
		Workflows:    wfRepo,
		Runs:         runRepo,
		LLM:          wfLLM,
		DefaultModel: domain.ModelOpenAI,
		RunnerCfg:    wfapp.DefaultRunnerConfig(),
		SendEmail:    sendMailUC,
		GetContact:   getContactUC,
	}
	wfHandlers = &httptransport.WorkflowHandlers{
		Create: createWF,
		Update: &wfapp.UpdateWorkflow{Workflows: wfRepo},
		Get:    &wfapp.GetWorkflow{Workflows: wfRepo},
		List:   &wfapp.ListWorkflows{Workflows: wfRepo},
		Delete: &wfapp.DeleteWorkflow{Workflows: wfRepo},
		Pin:    &wfapp.PinWorkflow{Workflows: wfRepo},
		Run:    runWfUC,
		Generate: &wfapp.GenerateWorkflow{LLM: wfLLM},
		SaveGenerated: &wfapp.SaveGeneratedWorkflow{
			Create: createWF,
		},
		ListRuns: &wfapp.ListWorkflowRuns{Runs: runRepo},
	}

	taskListRepo := tasklistsmysql.NewTaskListRepository(db)
	taskItemRepo := tasklistsmysql.NewTaskItemRepository(db)
	var taskExecutor tasklistsports.TaskExecutor
	if tex := tasklistsintel.NewTaskExecutorClient(cfg.PolvoIntelligenceBaseURL, cfg.PolvoIntelligenceInternalKey, cfg.AgentLLMTimeout); tex != nil {
		taskExecutor = tex
	}
	taskHandlers := &httptransport.TaskListHandlers{
		Create: &taskapp.CreateTaskList{Lists: taskListRepo, Items: taskItemRepo},
		Get:    &taskapp.GetTaskList{Lists: taskListRepo, Items: taskItemRepo},
		List:   &taskapp.ListTaskLists{Lists: taskListRepo},
		Delete: &taskapp.DeleteTaskList{Lists: taskListRepo},
		Run: &taskapp.RunTaskList{
			Lists:        taskListRepo,
			Items:        taskItemRepo,
			Executor:     taskExecutor,
			DefaultModel: string(domain.ModelOpenAI),
		},
	}

	convHandlers := &httptransport.ConversationHandlers{
		CreateConversation: createConvUC,
		ListConversations: &convapp.ListConversations{
			Conversations: convRepo,
		},
		GetConversationUC: &convapp.GetConversation{Conversations: convRepo},
		ListMessages: &convapp.ListMessages{
			Conversations: convRepo,
			Messages:      msgRepo,
		},
		SendMessage:        sendMsgUC,
		DeleteConversation: &convapp.DeleteConversation{Conversations: convRepo},
		PinConversation:    &convapp.PinConversation{Conversations: convRepo},
		RenameConversation: &convapp.RenameConversation{Conversations: convRepo},
	}

	readyCheck := func(ctx context.Context) error {
		if err := db.PingContext(ctx); err != nil {
			return err
		}
		return nil
	}

	handler := httptransport.NewRouter(httptransport.Deps{
		Config:        cfg,
		Auth:          authH,
		Agent:         agentH,
		Conversations: convHandlers,
		Workflows:     wfHandlers,
		TaskLists:     taskHandlers,
		Mail:          mailHandlers,
		Contacts:      contactHandlers,
		TokenParser:   issuer,
		ReadyCheck:    readyCheck,
	})

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		slog.Info("listening", "addr", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server", "err", err)
			os.Exit(1)
		}
	}()

	schedCtx, schedCancel := context.WithCancel(context.Background())
	if workflowSchedulerEnabled() {
		interval := 45 * time.Second
		if s := strings.TrimSpace(os.Getenv("WORKFLOW_SCHEDULER_INTERVAL")); s != "" {
			if d, err := time.ParseDuration(s); err == nil && d >= 10*time.Second {
				interval = d
			}
		}
		go wfapp.StartWorkflowScheduler(schedCtx, interval, &wfRepo, runWfUC, slog.Default())
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	schedCancel()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown", "err", err)
	}
}

func workflowSchedulerEnabled() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("WORKFLOW_SCHEDULER_ENABLED")))
	if v == "" {
		return true
	}
	return v == "1" || v == "true" || v == "yes"
}
